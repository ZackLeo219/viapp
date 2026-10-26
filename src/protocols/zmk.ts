import type {
  GetBehaviorDetailsResponse,
  BehaviorParameterValueDescription,
} from '@zmkfirmware/zmk-studio-ts-client/behaviors';
import type { Behavior, Binding, DeviceSnapshot, Driver } from '../domain/types';
import type { ZmkRpc } from './zmk-rpc';

export const TOFU_USB = { usbVendorId: 0x9d5b, usbProductId: 0x2566 };
const behaviorKinds: Record<string, Behavior['kind']> = {
  'key press': 'key',
  transparent: 'transparent',
  _trans: 'transparent',
  none: 'none',
  'key(none)': 'none',
  'momentary layer': 'momentary',
  'layer momentary': 'momentary',
  'toggle layer': 'toggle',
  'layer toggle': 'toggle',
};
export function describeBehavior(info: GetBehaviorDetailsResponse): Behavior {
  const parameters = info.metadata.map(
    (set) =>
      [set.param1, set.param2].filter(
        (values) => values.length && !values.every((v) => v.nil !== undefined),
      ).length,
  );
  return {
    id: info.id,
    name: info.displayName,
    kind: behaviorKinds[info.displayName.toLowerCase()] ?? 'other',
    parameterCount: parameters.length ? Math.max(...parameters) : 2,
  };
}
export function validParameter(
  value: number,
  specs: BehaviorParameterValueDescription[],
  layerIds: number[],
): boolean {
  // Studio represents an unused parameter as an empty list, as well as explicit nil.
  if (!specs.length) return value === 0;
  return specs.some((spec) => {
    if (spec.nil !== undefined) return value === 0;
    if (spec.constant !== undefined) return value === spec.constant;
    if (spec.range) return value >= spec.range.min && value <= spec.range.max;
    if (spec.layerId) return layerIds.includes(value);
    if (spec.hidUsage) {
      const page = (value >>> 16) & 255,
        usage = value & 65535;
      return (
        (page === 7 && usage <= spec.hidUsage.keyboardMax) ||
        (page === 12 && usage <= spec.hidUsage.consumerMax)
      );
    }
    return false;
  });
}

export class ZmkDriver implements Driver {
  readonly model = 'tofu-pad' as const;
  onDisconnect?: (reason: string) => void;
  onLockChange?: (locked: boolean) => void;
  private latest?: DeviceSnapshot;
  private metadata = new Map<number, GetBehaviorDetailsResponse>();
  constructor(readonly rpc: ZmkRpc) {
    rpc.onDisconnect = (reason) => this.onDisconnect?.(reason);
    rpc.onNotification = (notification) => {
      if (notification.core?.lockStateChanged !== undefined) {
        const locked = notification.core.lockStateChanged !== 1;
        if (this.latest) this.latest.locked = locked;
        this.onLockChange?.(locked);
      }
    };
  }
  static async connect(): Promise<ZmkDriver> {
    if (!window.isSecureContext || !navigator.serial)
      throw new Error('请使用桌面 Chrome / Edge，通过 HTTPS 或 localhost 打开网页。');
    const port = await navigator.serial.requestPort({ filters: [TOFU_USB] });
    const identity = port.getInfo();
    if (
      identity.usbVendorId !== TOFU_USB.usbVendorId ||
      identity.usbProductId !== TOFU_USB.usbProductId
    )
      throw new Error('当前只支持 TOFU PAD 原装双模 PCB。');
    const { ZmkRpc, serialTransport } = await import('./zmk-rpc');
    return new ZmkDriver(new ZmkRpc(await serialTransport(port)));
  }
  async read(): Promise<DeviceSnapshot> {
    const device = (await this.rpc.call({ core: { getDeviceInfo: true } })).core?.getDeviceInfo;
    if (!device || !/^tofu\s*pad\b/i.test(device.name))
      throw new Error('这不是受支持的 TOFU PAD 原厂固件，未进行写入。');
    const lockState = (await this.rpc.call({ core: { getLockState: true } })).core?.getLockState;
    if (lockState === undefined) throw new Error('未能读取 Studio 锁定状态。');
    const keymap = (await this.rpc.call({ keymap: { getKeymap: true } })).keymap?.getKeymap;
    const physical = (await this.rpc.call({ keymap: { getPhysicalLayouts: true } })).keymap
      ?.getPhysicalLayouts;
    const active = physical?.layouts[physical.activeLayoutIndex];
    if (
      !keymap ||
      !active ||
      !keymap.layers.length ||
      keymap.layers.length > 32 ||
      active.keys.length < 10 ||
      active.keys.length > 32 ||
      keymap.layers.some((l) => l.bindings.length !== active.keys.length)
    )
      throw new Error('设备的按键布局或层数据不完整，已停止读取。');
    const list = (await this.rpc.call({ behaviors: { listAllBehaviors: true } })).behaviors
      ?.listAllBehaviors;
    if (!list || list.behaviors.length > 256) throw new Error('设备未提供有效的行为列表。');
    for (const id of list.behaviors) {
      if (this.metadata.has(id)) continue;
      const details = (
        await this.rpc.call({ behaviors: { getBehaviorDetails: { behaviorId: id } } })
      ).behaviors?.getBehaviorDetails;
      if (!details || details.id !== id) throw new Error('设备返回了不匹配的行为定义。');
      this.metadata.set(id, details);
    }
    const unsaved = (await this.rpc.call({ keymap: { checkUnsavedChanges: true } })).keymap
      ?.checkUnsavedChanges;
    if (unsaved === undefined) throw new Error('未能确认设备的保存状态。');
    const snapshot: DeviceSnapshot = {
      model: this.model,
      name: 'TOFU PAD',
      identity: `9D5B:2566:${Array.from(device.serialNumber)
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')}`,
      protocol: 'zmk',
      protocolVersion: 1,
      layers: keymap.layers.map((l, index) => ({
        id: l.id,
        name: l.name || (index === 0 ? '基础层' : `功能层 ${index}`),
        bindings: l.bindings.map((b): Binding => ({ type: 'zmk', ...b })),
      })),
      keys: active.keys.map((k, index) => ({
        id: String(index),
        index,
        x: k.x / 100,
        y: k.y / 100,
        w: k.width / 100,
        h: k.height / 100,
        rotation: k.r / 100,
        rx: k.rx / 100,
        ry: k.ry / 100,
      })),
      behaviors: list.behaviors.map((id) => describeBehavior(this.metadata.get(id)!)),
      layoutOptions: physical!.activeLayoutIndex,
      macros: [],
      macroBufferSize: 0,
      locked: lockState !== 1,
      firmwareUnsaved: unsaved,
      capturedAt: new Date().toISOString(),
    };
    if (
      snapshot.keys.some(
        (k) =>
          !Number.isFinite(k.x + k.y + k.w + k.h) ||
          k.w <= 0 ||
          k.h <= 0 ||
          k.w > 10 ||
          k.h > 10 ||
          Math.abs(k.x) > 100 ||
          Math.abs(k.y) > 100,
      )
    )
      throw new Error('物理布局坐标无效。');
    this.latest = snapshot;
    return snapshot;
  }
  async writeBinding(layerId: number, index: number, binding: Binding) {
    if (!this.latest || binding.type !== 'zmk' || this.latest.locked)
      throw new Error('请先读取并解锁设备。');
    const layer = this.latest.layers.find((l) => l.id === layerId);
    const metadata = this.metadata.get(binding.behaviorId);
    if (
      !layer ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= layer.bindings.length ||
      !metadata ||
      ![binding.param1, binding.param2].every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff,
      )
    )
      throw new Error('按键位置或行为参数无效。');
    if (
      metadata.metadata.length &&
      !metadata.metadata.some(
        (set) =>
          validParameter(
            binding.param1,
            set.param1,
            this.latest!.layers.map((l) => l.id),
          ) &&
          validParameter(
            binding.param2,
            set.param2,
            this.latest!.layers.map((l) => l.id),
          ),
      )
    )
      throw new Error('该按键参数不符合原厂固件的行为定义。');
    const { behaviorId, param1, param2 } = binding;
    const response = await this.rpc.call({
      keymap: {
        setLayerBinding: { layerId, keyPosition: index, binding: { behaviorId, param1, param2 } },
      },
    });
    if (response.keymap?.setLayerBinding !== 0)
      throw new Error(`原厂固件拒绝修改按键（${response.keymap?.setLayerBinding ?? '无响应'}）。`);
  }
  async writeMacros(): Promise<void> {
    throw new Error('原厂 ZMK Studio 暂未开放新建宏；可以使用固件已有的宏行为。');
  }
  async commit() {
    const result = (await this.rpc.call({ keymap: { saveChanges: true } })).keymap?.saveChanges;
    if (result?.ok !== true)
      throw new Error(`设备未能永久保存配置（错误 ${result?.err ?? '未知'}）。`);
    const unsaved = (await this.rpc.call({ keymap: { checkUnsavedChanges: true } })).keymap
      ?.checkUnsavedChanges;
    if (unsaved !== false) throw new Error('设备仍报告有未保存修改，请保持连接并重试保存。');
  }
  async close() {
    await this.rpc.close();
  }
}
