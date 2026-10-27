import type { GetBehaviorDetailsResponse } from '@zmkfirmware/zmk-studio-ts-client/behaviors';
import type { Behavior, Binding, DeviceSnapshot, Driver, Layer } from '../domain/types';
import { defaultLayerName, layerName } from '../domain/types';
import type { ZmkRpc } from './zmk-rpc';
import { normalizeEmptyBindings, validParameter } from '../domain/behaviors';
import {
  identifyZmkDevice,
  serialFilters,
  ZMK_DEVICES,
  type ZmkDeviceDefinition,
} from '../devices/zmk-registry';
import { usbIdentity } from '../domain/via-definition';
export { validParameter } from '../domain/behaviors';
export { TOFU_USB } from '../devices/zmk-registry';
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
    metadata: structuredClone(info.metadata),
  };
}

export class ZmkDriver implements Driver {
  get model() {
    return this.definition.model;
  }
  onDisconnect?: (reason: string) => void;
  onLockChange?: (locked: boolean) => void;
  private latest?: DeviceSnapshot;
  private metadata = new Map<number, GetBehaviorDetailsResponse>();
  constructor(
    readonly rpc: ZmkRpc,
    private readonly definition: ZmkDeviceDefinition = ZMK_DEVICES[0],
  ) {
    rpc.onDisconnect = (reason) => this.onDisconnect?.(reason);
    rpc.onNotification = (notification) => {
      if (notification.core?.lockStateChanged !== undefined) {
        const locked = notification.core.lockStateChanged !== 1;
        if (this.latest) this.latest.locked = locked;
        this.onLockChange?.(locked);
      }
    };
  }
  static async connect(authorized?: SerialPort): Promise<ZmkDriver> {
    if (!window.isSecureContext || !navigator.serial)
      throw new Error('请使用桌面 Chrome / Edge，通过 HTTPS 或 localhost 打开网页。');
    const port = authorized ?? (await navigator.serial.requestPort({ filters: serialFilters }));
    const definition = identifyZmkDevice(port.getInfo());
    if (!definition) throw new Error('未收录这块 ZMK PCB，请先提交设备适配。');
    const { ZmkRpc, serialTransport } = await import('./zmk-rpc');
    return new ZmkDriver(new ZmkRpc(await serialTransport(port)), definition);
  }
  async read(): Promise<DeviceSnapshot> {
    const device = (await this.rpc.call({ core: { getDeviceInfo: true } })).core?.getDeviceInfo;
    if (!device || !this.definition.deviceName.test(device.name))
      throw new Error('设备名称与原厂 PCB 不匹配，未进行写入。');
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
      active.keys.length < this.definition.minKeys ||
      active.keys.length > this.definition.maxKeys ||
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
      name: this.definition.name,
      identity: `${usbIdentity(this.definition.usbVendorId, this.definition.usbProductId)}:${Array.from(
        device.serialNumber,
      )
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')}`,
      protocol: 'zmk',
      protocolVersion: 1,
      layers: keymap.layers.map((l) => ({
        id: l.id,
        name: l.name || defaultLayerName(l.id),
        storedName: l.name,
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
      deviceInfo: {
        firmware: [...this.metadata.values()]
          .map((b) => /^zmk_firmware_version_(.+)$/i.exec(b.displayName)?.[1])
          .find(Boolean),
        layerCapacity: Math.min(32, keymap.layers.length + keymap.availableLayers),
        physicalLayouts: physical!.layouts.map((layout, id) => ({
          id,
          name: layout.name,
          keys: layout.keys.map((k, index) => ({
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
        })),
      },
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
    this.latest = normalizeEmptyBindings(snapshot);
    return this.latest;
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
  async writeLayers(layers: Layer[]) {
    const current = this.latest;
    if (!current || current.locked || !current.deviceInfo?.layerCapacity)
      throw new Error('当前固件不支持图层管理。');
    const capacity = current.deviceInfo.layerCapacity ?? current.layers.length;
    if (
      !layers.length ||
      layers.length > capacity ||
      new Set(layers.map((l) => l.id)).size !== layers.length ||
      layers.some((l) => !Number.isInteger(l.id) || l.id < 0 || l.id >= capacity)
    )
      throw new Error('图层数量超出设备限制。');
    if (layers[0].id !== current.layers[0].id) throw new Error('请保留基础层的位置。');
    const ids = current.layers.map((l) => l.id);
    const names = new Map(current.layers.map((l) => [l.id, layerName(l)]));
    if (layers.some((layer) => names.has(layer.id) && names.get(layer.id) !== layerName(layer)))
      throw new Error('此固件暂不支持修改图层名称。');
    // Drop surplus layers before restoring archived layers so reserved capacity can be reused.
    for (let index = ids.length - 1; index >= 0; index--) {
      if (layers.some((l) => l.id === ids[index])) continue;
      const response = (await this.rpc.call({ keymap: { removeLayer: { layerIndex: index } } }))
        .keymap?.removeLayer;
      if (!response?.ok) throw new Error('设备未能删除图层。');
      ids.splice(index, 1);
    }
    for (const layer of layers) {
      if (ids.includes(layer.id)) continue;
      const response = (
        await this.rpc.call({
          keymap: { restoreLayer: { layerId: layer.id, atIndex: ids.length } },
        })
      ).keymap?.restoreLayer;
      if (response?.ok?.id !== layer.id) throw new Error('设备未能恢复图层。');
      ids.push(layer.id);
      names.set(layer.id, response.ok.name || defaultLayerName(layer.id));
    }
    for (let index = 0; index < layers.length; index++) {
      const layer = layers[index],
        startIndex = ids.indexOf(layer.id);
      if (startIndex !== index) {
        const response = (
          await this.rpc.call({ keymap: { moveLayer: { startIndex, destIndex: index } } })
        ).keymap?.moveLayer;
        if (!response?.ok || response.ok.layers[index]?.id !== layer.id)
          throw new Error('设备未能调整图层顺序。');
        ids.splice(index, 0, ids.splice(startIndex, 1)[0]);
      }
      const name = layerName(layer);
      if (names.get(layer.id) !== name) throw new Error('此固件暂不支持恢复不同的图层名称。');
    }
    // Binding validation must use the new set of layer IDs.
    this.latest = { ...current, layers: structuredClone(layers) };
  }
  async addLayer() {
    if (
      !this.latest ||
      this.latest.locked ||
      this.latest.layers.length >= (this.latest.deviceInfo?.layerCapacity ?? 0)
    )
      throw new Error('没有可用图层。');
    const response = (await this.rpc.call({ keymap: { addLayer: {} } })).keymap?.addLayer;
    if (!response?.ok?.layer || this.latest.layers.some((l) => l.id === response.ok!.layer!.id))
      throw new Error('设备未能新增图层。');
  }
  async discardChanges() {
    const response = (await this.rpc.call({ keymap: { discardChanges: true } })).keymap
      ?.discardChanges;
    if (response !== true) throw new Error('设备未能撤销修改。');
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
