import { describe, expect, it, vi } from 'vitest';
import { Request, Response } from '@zmkfirmware/zmk-studio-ts-client/studio';
import { FrameDecoder, encodeFrame } from './framing';
import { ZmkRpc, type ByteTransport } from './zmk-rpc';

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
