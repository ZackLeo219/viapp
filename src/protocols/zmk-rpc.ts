import {
  Request,
  Response,
  type RequestResponse,
  type Notification,
} from '@zmkfirmware/zmk-studio-ts-client/studio';
import { FrameDecoder, encodeFrame } from './framing';

export interface ByteTransport {
  read: ReadableStream<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
export class ZmkRpc {
  private nextId = 1;
  private closed = false;
  private closing?: Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();
  private pending = new Map<
    number,
    {
      resolve: (r: RequestResponse) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private loop: Promise<void>;
  onNotification?: (notification: Notification) => void;
  onDisconnect?: (reason: string) => void;
  constructor(
    private transport: ByteTransport,
    private timeout = 3000,
  ) {
    this.reader = transport.read.getReader();
    this.loop = this.listen();
  }
  private async listen() {
    const decoder = new FrameDecoder();
    try {
      while (!this.closed) {
        const { done, value } = await this.reader.read();
        if (done) {
          if (!this.closed) this.fail('USB 串口已断开。');
          break;
        }
        for (const frame of decoder.push(value)) {
          const response = Response.decode(frame);
          if (response.notification) this.onNotification?.(response.notification);
          const rr = response.requestResponse;
          if (!rr) continue;
          const pending = this.pending.get(rr.requestId);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(rr.requestId);
          if (rr.meta?.simpleError !== undefined) {
            pending.reject(
              new Error(
                rr.meta.simpleError === 1
                  ? 'Studio 已锁定，请在键盘上执行解锁操作后重新读取。'
                  : `ZMK 拒绝请求（错误 ${rr.meta.simpleError}）。`,
              ),
            );
          } else if (rr.meta?.noResponse)
            pending.reject(new Error('原厂固件未实现此项 Studio 功能。'));
          else pending.resolve(rr);
        }
      }
    } catch (error) {
      if (!this.closed) this.fail(error instanceof Error ? error.message : '读取 USB 串口失败。');
    } finally {
      this.reader.releaseLock();
    }
  }
  private fail(reason: string) {
    this.onDisconnect?.(reason);
    void this.close(reason);
  }
  call(request: Omit<Request, 'requestId'>): Promise<RequestResponse> {
    const task = this.chain.then(() => {
      if (this.closed) throw new Error('设备连接已经关闭，请重新连接。');
      // Only one request is in flight. Keep IDs in one protobuf byte for the
      // original firmware's small request buffer; timeout always closes the session.
      const requestId = this.nextId;
      this.nextId = (this.nextId % 127) + 1;
      return new Promise<RequestResponse>((resolve, reject) => {
        const timer = setTimeout(
          () => this.fail('ZMK 响应超时。请确认 USB 连接和输出模式，然后重连。'),
          this.timeout,
        );
        this.pending.set(requestId, { resolve, reject, timer });
        const frame = encodeFrame(Request.encode({ requestId, ...request }).finish());
        this.transport.write(frame).catch(() => this.fail('USB 串口发送失败。'));
      });
    });
    this.chain = task.catch(() => undefined);
    return task;
  }
  close(reason = '连接已关闭。'): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
    this.closing = (async () => {
      await this.reader.cancel().catch(() => undefined);
      await this.loop.catch(() => undefined);
      await this.transport.close().catch(() => undefined);
    })();
    return this.closing;
  }
}

export async function serialTransport(port: SerialPort): Promise<ByteTransport> {
  try {
    await port.open({ baudRate: 115200, bufferSize: 65536 });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'InvalidStateError')
      throw new Error('此页面的串口连接尚未释放，请关闭此页后重新打开。', { cause });
    if (cause instanceof DOMException && cause.name === 'NetworkError')
      throw new Error(
        '无法打开键盘串口。请关闭其他驱动页面或串口工具后重连；仍失败时重新插拔 USB。',
        { cause },
      );
    throw cause;
  }
  try {
    await port.setSignals({ dataTerminalReady: true });
    if (!port.readable || !port.writable) throw new Error('USB 串口没有提供读写通道。');
    const writer = port.writable.getWriter();
    let closing: Promise<void> | undefined;
    return {
      read: port.readable,
      // Pace writes for firmware with small CDC receive buffers.
      write: async (data) => {
        for (let offset = 0; offset < data.length; offset += 8) {
          if (closing) throw new Error('USB 串口已关闭。');
          if (offset) await new Promise((resolve) => setTimeout(resolve, 5));
          await writer.write(data.subarray(offset, offset + 8));
        }
      },
      close: () =>
        (closing ??= (async () => {
          await writer.close().catch(() => undefined);
          writer.releaseLock();
          await port.close();
        })()),
    };
  } catch (e) {
    await port.close().catch(() => undefined);
    throw e;
  }
}
