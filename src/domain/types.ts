import type { BehaviorBindingParametersSet } from '@zmkfirmware/zmk-studio-ts-client/behaviors';
import { snapshotLayout, type ViaDefinition } from './via-definition';
export type ModelId =
  | 'neo75cu'
  | 'neo65cu'
  | 'tofu-pad'
  | `via-${string}-${string}`
  | `zmk-${string}-${string}`;
export const isZmkModel = (model: ModelId) => model === 'tofu-pad' || model.startsWith('zmk-');
export type Binding =
  | { type: 'via'; code: number }
  | { type: 'zmk'; behaviorId: number; param1: number; param2: number };
export interface PhysicalKey {
  id: string;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  row?: number;
  col?: number;
  rotation?: number;
  rx?: number;
  ry?: number;
}
export interface Layer {
  id: number;
  name: string;
  storedName?: string;
  bindings: Binding[];
}
// Keep unnamed layers stable across reordering and older profile imports.
export const defaultLayerName = (id: number) => (id === 0 ? '基础层' : `层 ${id}`);
export const layerName = (layer: Layer) =>
  layer.storedName === '' ? defaultLayerName(layer.id) : layer.storedName || layer.name;
export interface Behavior {
  id: number;
  name: string;
  kind: 'key' | 'transparent' | 'none' | 'momentary' | 'toggle' | 'other';
  parameterCount: number;
  metadata?: BehaviorBindingParametersSet[];
}
export interface DeviceInfo {
  firmware?: string;
  layerCapacity?: number;
  physicalLayouts?: { id: number; name: string; keys: PhysicalKey[] }[];
}
export interface DeviceSnapshot {
  model: ModelId;
  name: string;
  protocol: 'via' | 'zmk';
  protocolVersion: number;
  identity: string;
  layers: Layer[];
  keys: PhysicalKey[];
  behaviors: Behavior[];
  layoutOptions: number;
  macros: number[][];
  macroBufferSize: number;
  locked: boolean;
  capturedAt: string;
  firmwareUnsaved: boolean;
  deviceInfo?: DeviceInfo;
  viaDefinition?: ViaDefinition;
}
export interface Change {
  layerId: number;
  index: number;
  before: Binding | null;
  after: Binding;
}
export interface Diagnostic {
  time: string;
  level: 'info' | 'success' | 'error';
  message: string;
}
export interface Driver {
  readonly model: ModelId;
  read(): Promise<DeviceSnapshot>;
  writeBinding(layerId: number, index: number, binding: Binding): Promise<void>;
  writeMacros(macros: number[][]): Promise<void>;
  writeLayout?(options: number): Promise<void>;
  writeLayers?(layers: Layer[]): Promise<void>;
  addLayer?(): Promise<void>;
  discardChanges?(): Promise<void>;
  readMatrix?(): Promise<number[] | null>;
  commit(): Promise<void>;
  close(): Promise<void>;
  onDisconnect?: (reason: string) => void;
  onLockChange?: (locked: boolean) => void;
}
export const MODEL_NAMES: Partial<Record<ModelId, string>> = {
  neo75cu: 'Neo75 Cu',
  neo65cu: 'Neo65 Cu',
  'tofu-pad': 'TOFU PAD',
};
export const equalBinding = (a: Binding, b: Binding): boolean =>
  a.type === b.type &&
  (a.type === 'via' && b.type === 'via'
    ? a.code === b.code
    : a.type === 'zmk' &&
      b.type === 'zmk' &&
      a.behaviorId === b.behaviorId &&
      a.param1 === b.param1 &&
      a.param2 === b.param2);
export function changesBetween(before: DeviceSnapshot, after: DeviceSnapshot): Change[] {
  assertCompatible(before, after, true);
  return after.layers.flatMap((layer) => {
    const previous = before.layers.find((l) => l.id === layer.id);
    return layer.bindings.flatMap((binding, index) =>
      previous && equalBinding(previous.bindings[index], binding)
        ? []
        : [{ layerId: layer.id, index, before: previous?.bindings[index] ?? null, after: binding }],
    );
  });
}
export function assertCompatible(a: DeviceSnapshot, b: DeviceSnapshot, editing = false): void {
  const layerChanges = editing && a.protocol === 'zmk' && !!a.deviceInfo?.layerCapacity;
  if (
    a.model !== b.model ||
    a.protocol !== b.protocol ||
    a.protocolVersion !== b.protocolVersion ||
    a.identity !== b.identity ||
    JSON.stringify(a.viaDefinition) !== JSON.stringify(b.viaDefinition) ||
    ((!editing || a.protocol !== 'via') && a.layoutOptions !== b.layoutOptions) ||
    a.macroBufferSize !== b.macroBufferSize ||
    a.macros.length !== b.macros.length ||
    (!layerChanges &&
      (a.layers.length !== b.layers.length ||
        a.layers.some(
          (l) => !b.layers.find((x) => x.id === l.id && x.bindings.length === l.bindings.length),
        ))) ||
    b.layers.some((l) => l.bindings.length !== a.layers[0].bindings.length) ||
    (layerChanges &&
      (b.layers.length < 1 ||
        b.layers.length > (a.deviceInfo?.layerCapacity ?? a.layers.length) ||
        new Set(b.layers.map((l) => l.id)).size !== b.layers.length ||
        b.layers.some(
          (l) =>
            !Number.isInteger(l.id) ||
            l.id < 0 ||
            l.id >= (a.deviceInfo?.layerCapacity ?? a.layers.length),
        )))
  ) {
    throw new Error('配置与当前设备或固件不匹配，未进行写入。请重新读取设备。');
  }
  if (editing && a.protocol === 'via' && a.layoutOptions !== b.layoutOptions) {
    if (
      b.layoutOptions < 0 ||
      b.layoutOptions > 0xffffffff ||
      !Number.isInteger(b.layoutOptions) ||
      JSON.stringify(b.keys) !== JSON.stringify(snapshotLayout(a, b.layoutOptions))
    )
      throw new Error('配列不符合原厂定义。');
  } else if (JSON.stringify(a.keys) !== JSON.stringify(b.keys))
    throw new Error('设备的物理配列已改变，请重新读取配置。');
  const identity = (s: DeviceSnapshot) => s.behaviors.map(({ metadata: _metadata, ...b }) => b);
  if (a.protocol === 'zmk' && JSON.stringify(identity(a)) !== JSON.stringify(identity(b)))
    throw new Error('ZMK 行为定义已改变，请重新读取配置。');
}
export const clone = <T>(value: T): T => structuredClone(value);
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const hex = (n: number, width = 4) =>
  `0x${n.toString(16).toUpperCase().padStart(width, '0')}`;
