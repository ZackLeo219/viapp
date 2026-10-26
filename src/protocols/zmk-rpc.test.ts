import { describe, expect, it, vi } from 'vitest';
import { Request, Response } from '@zmkfirmware/zmk-studio-ts-client/studio';
import { FrameDecoder, encodeFrame } from './framing';
import { ZmkRpc, serialTransport, type ByteTransport } from './zmk-rpc';

function fakeRpc(timeout = 1000) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const sent: Request[] = [];
  const transport: ByteTransport = {
    read: new ReadableStream({
      start(c) {
        controller = c;
      },
    }),
    write: async (bytes) => {
      const frame = new FrameDecoder().push(bytes)[0];
      sent.push(Request.decode(frame));
    },
    close: vi.fn(async () => {}),
  };
  const rpc = new ZmkRpc(transport, timeout);
  return {
    rpc,
    sent,
    transport,
    reply: (r: Response) => controller.enqueue(encodeFrame(Response.encode(r).finish())),
  };
}
describe('ZMK RPC lifecycle', () => {
  it('every close caller waits until the underlying serial connection has finished closing', async () => {
    const fake = fakeRpc();
    let release!: () => void;
    vi.mocked(fake.transport.close).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = fake.rpc.close();
    const second = fake.rpc.close();
    expect(second).toBe(first);
    let completed = false;
    void second.then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(fake.transport.close).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(completed).toBe(true);
  });
  it('handles a successful zero-valued enum and idle notifications', async () => {
    const fake = fakeRpc();
    const notification = vi.fn();
    fake.rpc.onNotification = notification;
    const result = fake.rpc.call({
      keymap: {
        setLayerBinding: {
          layerId: 5,
          keyPosition: 2,
          binding: { behaviorId: 14, param1: 0x70004, param2: 0 },
        },
      },
    });
    await Promise.resolve();
    fake.reply({ notification: { core: { lockStateChanged: 0 } } });
    fake.reply({
      requestResponse: { requestId: fake.sent[0].requestId, keymap: { setLayerBinding: 0 } },
    });
    expect((await result).keymap?.setLayerBinding).toBe(0);
    expect(notification).toHaveBeenCalledOnce();
    await fake.rpc.close();
    expect(fake.transport.close).toHaveBeenCalledOnce();
  });
  it('recognizes error code zero instead of treating it as success', async () => {
    const fake = fakeRpc();
    const request = fake.rpc.call({ core: { getLockState: true } });
    const assertion = expect(request).rejects.toThrow('错误 0');
    await Promise.resolve();
    fake.reply({
      requestResponse: { requestId: fake.sent[0].requestId, meta: { simpleError: 0 } },
    });
    await assertion;
    await fake.rpc.close();
  });
  it('invalidates a timed out session and rejects queued requests', async () => {
    vi.useFakeTimers();
    const fake = fakeRpc(50);
    const first = fake.rpc.call({ core: { getDeviceInfo: true } });
    const next = fake.rpc.call({ core: { getLockState: true } });
    const a = expect(first).rejects.toThrow('超时'),
      b = expect(next).rejects.toThrow('关闭');
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([a, b]);
    expect(fake.sent).toHaveLength(1);
    await fake.rpc.close();
    vi.useRealTimers();
  });
  it('keeps separate devices independent', async () => {
    const a = fakeRpc(),
      b = fakeRpc();
    const ra = a.rpc.call({ core: { getLockState: true } }),
      rb = b.rpc.call({ core: { getLockState: true } });
    await Promise.resolve();
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    a.reply({ requestResponse: { requestId: a.sent[0].requestId, core: { getLockState: 1 } } });
    b.reply({ requestResponse: { requestId: b.sent[0].requestId, core: { getLockState: 0 } } });
    expect((await ra).core?.getLockState).toBe(1);
    expect((await rb).core?.getLockState).toBe(0);
    await Promise.all([a.rpc.close(), b.rpc.close()]);
  });
});

describe('serial port ownership and errors', () => {
  function fakePort() {
    return {
      open: vi.fn(async () => {}),
      setSignals: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
    };
  }
  it('explains a failed open without closing a port it did not acquire', async () => {
    const port = fakePort();
    const cause = new DOMException(
      "Failed to execute 'open' on 'SerialPort': Failed to open serial port.",
      'NetworkError',
    );
    port.open.mockRejectedValue(cause);
    const error = await serialTransport(port as unknown as SerialPort).catch((e: Error) => e);
    expect(error).toMatchObject({ message: expect.stringContaining('关闭其他驱动页面'), cause });
    expect(port.close).not.toHaveBeenCalled();
    expect(port.setSignals).not.toHaveBeenCalled();
  });
  it('distinguishes an already-open port from a failed open', async () => {
    const port = fakePort();
    port.open.mockRejectedValue(new DOMException('Already open', 'InvalidStateError'));
    await expect(serialTransport(port as unknown as SerialPort)).rejects.toThrow(
      '此页面的串口连接尚未释放',
    );
    expect(port.close).not.toHaveBeenCalled();
  });
  it('releases a successfully opened port when signal configuration fails', async () => {
    const port = fakePort();
    port.setSignals.mockRejectedValue(new Error('Device removed'));
    await expect(serialTransport(port as unknown as SerialPort)).rejects.toThrow('Device removed');
    expect(port.close).toHaveBeenCalledOnce();
  });
  it('releases the writer before closing the port and waits for one shared close operation', async () => {
    const port = fakePort();
    let release!: () => void;
    port.close.mockImplementation(() => {
      expect(port.writable.locked).toBe(false);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const transport = await serialTransport(port as unknown as SerialPort);
    expect(port.writable.locked).toBe(true);
    await transport.write(new Uint8Array([1, 2, 3]));
    const first = transport.close(),
      second = transport.close();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
    release();
    await first;
    await transport.close();
    expect(port.close).toHaveBeenCalledOnce();
  });
});
