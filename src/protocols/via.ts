import type { Binding, DeviceSnapshot, Driver } from '../domain/types';
import { neoLayout } from '../domain/layouts';

export const NEO_USB = { vendorId: 0x36b0, productId: 0x3021, usagePage: 0xff60, usage: 0x61 };
export class ViaTransport {
  private chain: Promise<unknown> = Promise.resolve();
  private pending?: {
    resolve: (v: Uint8Array) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    prefix: number[];
  };
  private closed = false;
  private closing?: Promise<void>;
  onDisconnect?: (reason: string) => void;
  constructor(
    private device: HIDDevice,
    private timeout = 2000,
  ) {
    device.addEventListener('inputreport', this.onReport);
  }
  private onReport = (event: HIDInputReportEvent) => {
    const current = this.pending;
    if (!current) return;
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    if (bytes[0] === 0xff) {
      this.settle(new Error('原厂固件不支持这条 VIA 命令。'));
      return;
    }
    if (bytes.length !== 32 || !current.prefix.every((n, i) => bytes[i] === n)) {
      this.fail('设备返回的数据与请求不匹配，连接已关闭，请重新连接。');
      return;
    }
    this.settle(undefined, new Uint8Array(bytes));
  };
  private settle(error?: Error, value?: Uint8Array) {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return;
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(value!);
  }
  private fail(reason: string) {
    this.settle(new Error(reason));
    void this.close();
    this.onDisconnect?.(reason);
  }
  exchange(command: number[], prefixLength = 1): Promise<Uint8Array> {
    if (!command.length || command.length > 32)
      return Promise.reject(new Error('VIA 请求长度无效。'));
    const task = this.chain.then(() => {
      if (this.closed) throw new Error('设备连接已经关闭，请重新连接。');
      return new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(
          () => this.fail('设备响应超时。请确认有线模式，并关闭其他键盘配置网页后重连。'),
          this.timeout,
        );
        this.pending = { resolve, reject, timer, prefix: command.slice(0, prefixLength) };
        const bytes = new Uint8Array(32);
        bytes.set(command);
        this.device.sendReport(0, bytes).catch(() => this.fail('发送失败，设备可能已经断开。'));
      });
    });
    this.chain = task.catch(() => undefined);
    return task;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.settle(new Error('连接已关闭。'));
    this.device.removeEventListener('inputreport', this.onReport);
    this.closing = this.device.opened
      ? this.device.close().catch(() => undefined)
      : Promise.resolve();
    return this.closing;
  }
  disconnected() {
    this.fail('键盘已拔出，未保存的编辑仍保留在页面中。');
  }
}

export function decodeMacroBuffer(buffer: Uint8Array, count: number): number[][] {
  const result: number[][] = [];
  let start = 0;
  for (let i = 0; i < buffer.length && result.length < count; i++)
    if (buffer[i] === 0) {
      result.push(Array.from(buffer.slice(start, i)));
      start = i + 1;
    }
  if (result.length !== count)
    throw new Error('设备宏数据缺少结束标记，已停止读取以保护现有配置。');
  return result;
}
export function encodeMacroBuffer(macros: number[][], capacity: number): Uint8Array {
  const data = macros.flatMap((m) => [...m, 0]);
  if (
    data.length >= capacity ||
    macros.some((m) => m.some((n) => !Number.isInteger(n) || n < 1 || n > 255))
  )
    throw new Error('宏内容无效或超出设备容量。');
  const result = new Uint8Array(capacity);
  result.set(data);
  return result;
}

export class ViaDriver implements Driver {
  readonly model = 'neo75cu' as const;
  onDisconnect?: (reason: string) => void;
  private latest?: DeviceSnapshot;
  constructor(
    readonly transport: ViaTransport,
    private device?: HIDDevice,
  ) {
    transport.onDisconnect = (reason) => this.onDisconnect?.(reason);
    if (typeof navigator !== 'undefined' && navigator.hid)
      navigator.hid.addEventListener('disconnect', this.handleDisconnect);
  }
  static async connect(authorized?: HIDDevice): Promise<ViaDriver> {
    if (!window.isSecureContext || !navigator.hid)
      throw new Error('请使用桌面 Chrome / Edge，通过 HTTPS 或 localhost 打开网页。');
    const device = authorized ?? (await navigator.hid.requestDevice({ filters: [NEO_USB] }))[0];
    if (!device) throw new DOMException('已取消选择设备。', 'NotFoundError');
    if (device.vendorId !== NEO_USB.vendorId || device.productId !== NEO_USB.productId)
      throw new Error('当前只支持 Neo75 Cu 原装三模 PCB。');
    if (
      !device.collections.some(
        (c) => c.usagePage === NEO_USB.usagePage && c.usage === NEO_USB.usage,
      )
    )
      throw new Error('设备未开放 VIA 配置接口，请使用 USB 有线模式。');
    await device.open();
    return new ViaDriver(new ViaTransport(device), device);
  }
  private handleDisconnect = (event: HIDConnectionEvent) => {
    if (event.device === this.device) this.transport.disconnected();
  };
  private async buffer(command: number, length: number) {
    const result = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += 28) {
      const size = Math.min(28, length - offset);
      const response = await this.transport.exchange(
        [command, offset >>> 8, offset & 255, size],
        4,
      );
      result.set(response.slice(4, 4 + size), offset);
    }
    return result;
  }
  async read(): Promise<DeviceSnapshot> {
    const proto = await this.transport.exchange([1]);
    const version = proto[1] * 256 + proto[2];
    if (![9, 10, 11, 12].includes(version))
      throw new Error(`暂不支持 VIA 协议 ${version}，未进行写入。`);
    const count = (await this.transport.exchange([0x11]))[1];
    if (count < 1 || count > 16) throw new Error('设备报告的层数量无效。');
    const layout = await this.transport.exchange([2, 2], 2);
    const layoutOptions = new DataView(layout.buffer).getUint32(2, false);
    const raw = await this.buffer(0x12, count * 96 * 2);
    const layers = Array.from({ length: count }, (_, id) => ({
      id,
      name: id === 0 ? '基础层' : `功能层 ${id}`,
      bindings: Array.from(
        { length: 96 },
        (_, index): Binding => ({
          type: 'via',
          code: raw[(id * 96 + index) * 2] * 256 + raw[(id * 96 + index) * 2 + 1],
        }),
      ),
    }));
    const macroCount = (await this.transport.exchange([0x0c]))[1];
    const sizeResponse = await this.transport.exchange([0x0d]);
    const macroBufferSize = sizeResponse[1] * 256 + sizeResponse[2];
    if (
      macroCount > 64 ||
      macroBufferSize > 16384 ||
      (macroCount > 0 && macroBufferSize <= macroCount)
    )
      throw new Error('设备报告的宏容量无效。');
    const macroBuffer = macroCount ? await this.buffer(0x0e, macroBufferSize) : new Uint8Array();
    if (macroCount && macroBuffer[macroBuffer.length - 1] !== 0)
      throw new Error('设备宏缓冲区处于未完成写入状态，请先在原厂工具恢复宏配置。');
    const snapshot: DeviceSnapshot = {
      model: this.model,
      name: 'Neo75 Cu',
      identity: '36B0:3021',
      protocol: 'via',
      protocolVersion: version,
      layers,
      keys: neoLayout(layoutOptions),
      layoutOptions,
      behaviors: [],
      macros: decodeMacroBuffer(macroBuffer, macroCount),
      macroBufferSize,
      locked: false,
      firmwareUnsaved: false,
      capturedAt: new Date().toISOString(),
    };
    this.latest = snapshot;
    return snapshot;
  }
  async writeBinding(layerId: number, index: number, binding: Binding) {
    if (
      !this.latest ||
      binding.type !== 'via' ||
      !this.latest.layers.some((l) => l.id === layerId) ||
      index < 0 ||
      index >= 96 ||
      !Number.isInteger(index) ||
      !Number.isInteger(binding.code) ||
      binding.code < 0 ||
      binding.code > 65535
    )
      throw new Error('无效的按键配置。');
    await this.transport.exchange(
      [5, layerId, Math.floor(index / 16), index % 16, binding.code >>> 8, binding.code & 255],
      6,
    );
    const check = await this.transport.exchange(
      [4, layerId, Math.floor(index / 16), index % 16],
      4,
    );
    if (check[4] * 256 + check[5] !== binding.code)
      throw new Error('设备没有保留刚写入的按键。请检查备份并重新读取。');
  }
  async writeMacros(macros: number[][]) {
    if (!this.latest || macros.length !== this.latest.macros.length)
      throw new Error('宏数量与设备不符。');
    const buffer = encodeMacroBuffer(macros, this.latest.macroBufferSize);
    const last = buffer.length - 1;
    await this.transport.exchange([0x0f, last >>> 8, last & 255, 1, 0xff], 4);
    for (let offset = 0; offset < last; offset += 28) {
      const chunk = buffer.slice(offset, Math.min(offset + 28, last));
      await this.transport.exchange([0x0f, offset >>> 8, offset & 255, chunk.length, ...chunk], 4);
    }
    const check = await this.buffer(0x0e, buffer.length);
    if (!buffer.slice(0, last).every((n, i) => check[i] === n))
      throw new Error('宏写入校验失败，备份已保留。');
    await this.transport.exchange([0x0f, last >>> 8, last & 255, 1, 0], 5);
  }
  async writeLayout(options: number) {
    if (!this.latest || !Number.isInteger(options) || options < 0 || options > 15)
      throw new Error('配列选项无效。');
    await this.transport.exchange([3, 2, 0, 0, 0, options], 2);
    const response = await this.transport.exchange([2, 2], 2);
    if (new DataView(response.buffer, response.byteOffset).getUint32(2, false) !== options)
      throw new Error('设备没有保留配列设置。');
    this.latest = { ...this.latest, layoutOptions: options, keys: neoLayout(options) };
  }
  async readMatrix(): Promise<number[] | null> {
    if (this.latest?.protocolVersion !== 12) return null;
    let response: Uint8Array;
    try {
      response = await this.transport.exchange([2, 3, 0], 3);
    } catch (error) {
      if (error instanceof Error && error.message.includes('不支持这条')) return null;
      throw error;
    }
    const held: number[] = [];
    // Protocol 12 returns six big-endian 16-bit rows after the command, value ID and row offset.
    for (let row = 0; row < 6; row++) {
      const bits = response[3 + row * 2] * 256 + response[4 + row * 2];
      for (let col = 0; col < 16; col++) if (bits & (1 << col)) held.push(row * 16 + col);
    }
    return held;
  }
  async commit() {
    /* VIA persists each write in the device; no commit opcode exists. */
  }
  async close() {
    if (typeof navigator !== 'undefined' && navigator.hid)
      navigator.hid.removeEventListener('disconnect', this.handleDisconnect);
    await this.transport.close();
  }
}
