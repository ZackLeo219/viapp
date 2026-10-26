import { clone, type DeviceSnapshot, type ModelId, type Binding } from './types';
export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  kind: 'manual' | 'backup' | 'draft';
  snapshot: DeviceSnapshot;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length <= max;
function validBinding(b: unknown, protocol: string): b is Binding {
  if (!record(b)) return false;
  return protocol === 'via'
    ? b.type === 'via' && integer(b.code, 0, 65535)
    : b.type === 'zmk' &&
        integer(b.behaviorId, 0, 65535) &&
        integer(b.param1, 0, 0xffffffff) &&
        integer(b.param2, 0, 0xffffffff);
}
export function validateSnapshot(value: unknown): DeviceSnapshot {
  const bad = () => {
    throw new Error('配置文件结构无效或超出允许范围，未修改当前草稿。');
  };
  if (!record(value)) return bad();
  const s = value;
  if (
    !['neo75cu', 'tofu-pad'].includes(String(s.model)) ||
    (s.model === 'neo75cu' ? s.protocol !== 'via' : s.protocol !== 'zmk') ||
    !text(s.name) ||
    !text(s.identity) ||
    !text(s.capturedAt) ||
    !integer(s.protocolVersion, 1, 65535) ||
    !integer(s.layoutOptions, 0, 0xffffffff) ||
    typeof s.locked !== 'boolean' ||
    typeof s.firmwareUnsaved !== 'boolean' ||
    !integer(s.macroBufferSize, 0, 16384)
  )
    return bad();
  if (
    !Array.isArray(s.layers) ||
    s.layers.length < 1 ||
    s.layers.length > 32 ||
    new Set(s.layers.map((l: unknown) => (record(l) ? l.id : null))).size !== s.layers.length
  )
    return bad();
  for (const layer of s.layers) {
    if (
      !record(layer) ||
      !integer(layer.id, 0, 255) ||
      !text(layer.name, 80) ||
      !Array.isArray(layer.bindings) ||
      layer.bindings.length < 1 ||
      layer.bindings.length > 128 ||
      !layer.bindings.every((b) => validBinding(b, String(s.protocol)))
    )
      return bad();
  }
  const size = s.layers[0].bindings.length;
  if (s.layers.some((l) => l.bindings.length !== size) || (s.model === 'neo75cu' && size !== 96))
    return bad();
  if (
    !Array.isArray(s.keys) ||
    s.keys.length < 1 ||
    s.keys.length > 128 ||
    new Set(s.keys.map((k: unknown) => (record(k) ? k.index : null))).size !== s.keys.length
  )
    return bad();
  for (const key of s.keys) {
    if (
      !record(key) ||
      !text(key.id, 64) ||
      !integer(key.index, 0, size - 1) ||
      !['x', 'y', 'w', 'h'].every(
        (n) =>
          typeof key[n] === 'number' &&
          Number.isFinite(key[n]) &&
          Math.abs(key[n] as number) <= 100,
      ) ||
      (key.w as number) <= 0 ||
      (key.h as number) <= 0 ||
      !['rotation', 'rx', 'ry', 'row', 'col'].every(
        (n) =>
          key[n] === undefined ||
          (typeof key[n] === 'number' &&
            Number.isFinite(key[n]) &&
            Math.abs(key[n] as number) <= 360),
      )
    )
      return bad();
  }
  if (
    !Array.isArray(s.behaviors) ||
    s.behaviors.length > 256 ||
    s.behaviors.some(
      (b) =>
        !record(b) ||
        !integer(b.id, 0, 65535) ||
        !text(b.name) ||
        !['key', 'none', 'transparent', 'momentary', 'toggle', 'other'].includes(String(b.kind)) ||
        !integer(b.parameterCount, 0, 2),
    )
  )
    return bad();
  if (
    !Array.isArray(s.macros) ||
    s.macros.length > 64 ||
    s.macros.some(
      (m) => !Array.isArray(m) || m.length > 16384 || m.some((n) => !integer(n, 1, 255)),
    ) ||
    s.macros.flat().length + s.macros.length > (s.macroBufferSize as number)
  )
    return bad();
  return clone(s) as unknown as DeviceSnapshot;
}
export function parseProfile(contents: string): { name: string; snapshot: DeviceSnapshot } {
  if (contents.length > 2_000_000) throw new Error('配置文件不能超过 2 MB。');
  let data: unknown;
  try {
    data = JSON.parse(contents);
  } catch {
    throw new Error('无法解析 JSON 配置文件。');
  }
  if (
    !record(data) ||
    data.format !== 'viapp-profile' ||
    data.version !== 1 ||
    !text(data.name, 80)
  )
    throw new Error('请选择 VIAPP 导出的版本 1 配置文件。');
  return { name: data.name, snapshot: validateSnapshot(data.snapshot) };
}
export function exportProfile(profile: Pick<Profile, 'name' | 'snapshot'>) {
  return JSON.stringify(
    { format: 'viapp-profile', version: 1, name: profile.name, snapshot: profile.snapshot },
    null,
    2,
  );
}
export function modelFromProfile(profile: Profile): ModelId {
  return profile.snapshot.model;
}
