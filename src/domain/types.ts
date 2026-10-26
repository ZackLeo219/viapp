export type ModelId = 'neo75cu' | 'tofu-pad';
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
  bindings: Binding[];
}
export interface Behavior {
  id: number;
  name: string;
  kind: 'key' | 'transparent' | 'none' | 'momentary' | 'toggle' | 'other';
  parameterCount: number;
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
}
export interface Change {
  layerId: number;
  index: number;
  before: Binding;
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
  commit(): Promise<void>;
  close(): Promise<void>;
  onDisconnect?: (reason: string) => void;
  onLockChange?: (locked: boolean) => void;
}
export const MODEL_NAMES: Record<ModelId, string> = { neo75cu: 'Neo75 Cu', 'tofu-pad': 'TOFU PAD' };
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
  assertCompatible(before, after);
  return before.layers.flatMap((layer) => {
    const next = after.layers.find((l) => l.id === layer.id)!;
    return layer.bindings.flatMap((binding, index) =>
      equalBinding(binding, next.bindings[index])
        ? []
        : [{ layerId: layer.id, index, before: binding, after: next.bindings[index] }],
    );
  });
}
export function assertCompatible(a: DeviceSnapshot, b: DeviceSnapshot): void {
  if (
    a.model !== b.model ||
    a.protocol !== b.protocol ||
    a.protocolVersion !== b.protocolVersion ||
    a.identity !== b.identity ||
    a.layoutOptions !== b.layoutOptions ||
    a.macroBufferSize !== b.macroBufferSize ||
    a.macros.length !== b.macros.length ||
    a.layers.length !== b.layers.length ||
    a.layers.some(
      (l) => !b.layers.find((x) => x.id === l.id && x.bindings.length === l.bindings.length),
    )
  ) {
    throw new Error('配置与当前设备或固件不匹配，未进行写入。请重新读取设备。');
  }
  if (JSON.stringify(a.keys) !== JSON.stringify(b.keys))
    throw new Error('设备的物理配列已改变，请重新读取配置。');
  if (a.protocol === 'zmk' && JSON.stringify(a.behaviors) !== JSON.stringify(b.behaviors))
    throw new Error('ZMK 行为定义已改变，请重新读取配置。');
}
export const clone = <T>(value: T): T => structuredClone(value);
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const hex = (n: number, width = 4) =>
  `0x${n.toString(16).toUpperCase().padStart(width, '0')}`;
