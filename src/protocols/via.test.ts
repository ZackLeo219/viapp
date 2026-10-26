import { describe, expect, it, vi } from 'vitest';
import { ViaDriver, ViaTransport, decodeMacroBuffer, encodeMacroBuffer } from './via';

function fakeHid() {
  let listener: ((event: HIDInputReportEvent) => void) | undefined;
  const keymap = new Uint8Array(2 * 96 * 2);
  keymap[0] = 0x52;
  keymap[1] = 0x21;
  const macros = new Uint8Array(128);
  macros.set([65, 66, 0, 0]);
  const requests: number[][] = [];
  const device = {
    opened: true,
    addEventListener: (_: string, fn: (e: HIDInputReportEvent) => void) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = undefined;
    },
    close: vi.fn(async () => {
      device.opened = false;
    }),
    sendReport: vi.fn(async (_id: number, source: Uint8Array) => {
      const b = new Uint8Array(source);
      requests.push(Array.from(b));
      const r = new Uint8Array(b);
      if (b[0] === 1) {
        r[1] = 0;
        r[2] = 12;
      } else if (b[0] === 0x11) r[1] = 2;
      else if (b[0] === 0x0c) r[1] = 2;
      else if (b[0] === 0x0d) {
        r[1] = 0;
        r[2] = macros.length;
      } else if (b[0] === 0x12 || b[0] === 0x0e) {
        const buffer = b[0] === 0x12 ? keymap : macros;
        const offset = b[1] * 256 + b[2];
        r.set(buffer.slice(offset, offset + b[3]), 4);
      } else if (b[0] === 0x0f) macros.set(b.slice(4, 4 + b[3]), b[1] * 256 + b[2]);
      else if (b[0] === 5) keymap.set(b.slice(4, 6), ((b[1] * 6 + b[2]) * 16 + b[3]) * 2);
      else if (b[0] === 4) {
        const offset = ((b[1] * 6 + b[2]) * 16 + b[3]) * 2;
        r.set(keymap.slice(offset, offset + 2), 4);
      }
      queueMicrotask(() =>
        listener?.({ data: new DataView(r.buffer), reportId: 0 } as HIDInputReportEvent),
      );
    }),
  };
  return { device: device as unknown as HIDDevice, requests, keymap, macros };
}
describe('VIA stock adapter', () => {
  it('reads big-endian matrix buffers across chunk boundaries and verifies a write', async () => {
    const fake = fakeHid(),
      driver = new ViaDriver(new ViaTransport(fake.device));
    const snapshot = await driver.read();
    expect(snapshot.layers).toHaveLength(2);
    expect(snapshot.layers[0].bindings[0]).toEqual({ type: 'via', code: 0x5221 });
    expect(snapshot.keys).toHaveLength(81);
    expect(snapshot.macros).toEqual([[65, 66], []]);
    await driver.writeBinding(1, 95, { type: 'via', code: 0x7e04 });
    expect(fake.keymap.slice(-2)).toEqual(Uint8Array.from([0x7e, 4]));
    expect(fake.requests.at(-1)?.slice(0, 4)).toEqual([4, 1, 5, 15]);
    await driver.writeMacros([[67, 68], [69]]);
    expect(fake.macros.slice(0, 6)).toEqual(Uint8Array.from([67, 68, 0, 69, 0, 0]));
    expect(fake.macros[127]).toBe(0);
    await driver.close();
  });
  it('closes on timeout so late replies cannot satisfy another request', async () => {
    vi.useFakeTimers();
    const fake = fakeHid();
    vi.mocked(fake.device.sendReport).mockResolvedValue(undefined);
    const transport = new ViaTransport(fake.device, 50);
    const a = transport.exchange([1]),
      b = transport.exchange([1]);
    const ea = expect(a).rejects.toThrow('超时'),
      eb = expect(b).rejects.toThrow('关闭');
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([ea, eb]);
    expect(fake.device.close).toHaveBeenCalledOnce();
    expect(fake.device.sendReport).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('preserves unknown macro bytes and rejects overflowing capacity', () => {
    expect(decodeMacroBuffer(Uint8Array.of(255, 8, 0, 0), 2)).toEqual([[255, 8], []]);
    expect(() => decodeMacroBuffer(Uint8Array.of(1, 2, 3), 1)).toThrow('结束');
    expect(() => encodeMacroBuffer([[65, 66]], 3)).toThrow('容量');
    expect(() => encodeMacroBuffer([[0]], 10)).toThrow('无效');
  });
  it('waits for an in-flight HID close before reconnecting after a transport failure', async () => {
    const fake = fakeHid();
    let release!: () => void;
    vi.mocked(fake.device.close).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const transport = new ViaTransport(fake.device);
    transport.disconnected();
    let released = false;
    const closing = transport.close();
    void closing.then(() => {
      released = true;
    });
    expect(transport.close()).toBe(closing);
    await Promise.resolve();
    expect(released).toBe(false);
    expect(fake.device.close).toHaveBeenCalledOnce();
    release();
    await closing;
    expect(released).toBe(true);
  });
});
