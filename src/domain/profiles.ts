import { clone, type DeviceSnapshot, type ModelId, type Binding } from './types';
import {
  validModel,
  validateCompiledDefinition,
  definitionLayout,
  usbIdentity,
  viaModel,
} from './via-definition';
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
function validMetadata(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every(
      (set) =>
        record(set) &&
        ['param1', 'param2'].every(
          (key) =>
            Array.isArray(set[key]) &&
            set[key].length <= 64 &&
            set[key].every((spec: unknown) => {
              if (!record(spec) || !text(spec.name)) return false;
              const kinds = ['nil', 'constant', 'range', 'hidUsage', 'layerId'].filter(
                (k) => spec[k] !== undefined,
              );
              if (kinds.length !== 1) return false;
              if (spec.constant !== undefined) return integer(spec.constant, 0, 0xffffffff);
              if (spec.range !== undefined)
                return (
                  record(spec.range) &&
                  integer(spec.range.min, 0, 0xffffffff) &&
                  integer(spec.range.max, spec.range.min, 0xffffffff)
                );
              if (spec.hidUsage !== undefined)
                return (
                  record(spec.hidUsage) &&
                  integer(spec.hidUsage.keyboardMax, 0, 65535) &&
                  integer(spec.hidUsage.consumerMax, 0, 65535)
                );
              return record(spec[kinds[0]]);
            }),
        ),
    )
  );
}
export function validateSnapshot(value: unknown): DeviceSnapshot {
  const bad = () => {
    throw new Error('配置文件结构无效或超出允许范围，未修改当前草稿。');
  };
  if (!record(value)) return bad();
  const s = value;
  if (
    !validModel(s.model) ||
    (s.model === 'tofu-pad' ? s.protocol !== 'zmk' : s.protocol !== 'via') ||
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
      (layer.storedName !== undefined && !text(layer.storedName, 80)) ||
      !Array.isArray(layer.bindings) ||
      layer.bindings.length < 1 ||
      layer.bindings.length > (s.protocol === 'via' ? 512 : 128) ||
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
    s.keys.length > 512 ||
    new Set(s.keys.map((k: unknown) => (record(k) ? k.id : null))).size !== s.keys.length ||
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
  if (s.protocol === 'via' && s.model !== 'neo75cu') {
    const definition = validateCompiledDefinition(s.viaDefinition);
    if (
      size !== definition.matrix.rows * definition.matrix.cols ||
      viaModel(definition.vendorId, definition.productId) !== s.model ||
      usbIdentity(definition.vendorId, definition.productId) !== s.identity ||
      JSON.stringify(definitionLayout(definition, s.layoutOptions as number)) !==
        JSON.stringify(s.keys)
    )
      return bad();
  } else if (s.viaDefinition !== undefined) return bad();
  if (
    !Array.isArray(s.behaviors) ||
    s.behaviors.length > 256 ||
    new Set(s.behaviors.map((b: unknown) => (record(b) ? b.id : null))).size !==
      s.behaviors.length ||
    s.behaviors.some(
      (b) =>
        !record(b) ||
        !integer(b.id, 0, 65535) ||
        !text(b.name) ||
        !['key', 'none', 'transparent', 'momentary', 'toggle', 'other'].includes(String(b.kind)) ||
        !integer(b.parameterCount, 0, 2) ||
        (b.metadata !== undefined && !validMetadata(b.metadata)),
    )
  )
    return bad();
  if (
    !Array.isArray(s.macros) ||
    s.macros.length > 64 ||
    s.macros.some(
      (m) => !Array.isArray(m) || m.length > 16384 || m.some((n) => !integer(n, 1, 255)),
    ) ||
    s.macros.flat().length + s.macros.length > (s.macroBufferSize as number) ||
    (s.protocol === 'via' &&
      s.macros.length > 0 &&
      s.macros.flat().length + s.macros.length === s.macroBufferSize)
  )
    return bad();
  if (s.deviceInfo !== undefined) {
    const info = s.deviceInfo;
    if (
      !record(info) ||
      (info.firmware !== undefined && !text(info.firmware, 128)) ||
      (info.layerCapacity !== undefined && !integer(info.layerCapacity, s.layers.length, 32))
    )
      return bad();
    if (info.physicalLayouts !== undefined) {
      if (
        !Array.isArray(info.physicalLayouts) ||
        info.physicalLayouts.length > 32 ||
        info.physicalLayouts.some(
          (layout) =>
            !record(layout) ||
            !integer(layout.id, 0, 31) ||
            !text(layout.name, 128) ||
            !Array.isArray(layout.keys) ||
            layout.keys.length > 128 ||
            layout.keys.some(
              (key: unknown) =>
                !record(key) ||
                !text(key.id, 64) ||
                !integer(key.index, 0, 127) ||
                !['x', 'y', 'w', 'h'].every(
                  (n) =>
                    typeof key[n] === 'number' &&
                    Number.isFinite(key[n]) &&
                    Math.abs(key[n]) <= 100,
                ) ||
                (key.w as number) <= 0 ||
                (key.h as number) <= 0,
            ),
        )
      )
        return bad();
    }
  }
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
