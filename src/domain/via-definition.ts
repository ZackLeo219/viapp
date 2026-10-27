import type { DeviceSnapshot, ModelId, PhysicalKey } from './types';
import { neoLayout } from './layouts';

export interface LayoutOption {
  label: string;
  choices: string[];
}
export interface DefinitionKey extends PhysicalKey {
  option?: [number, number];
  decal?: boolean;
}
export interface ViaDefinition {
  version: 1;
  name: string;
  vendorId: number;
  productId: number;
  matrix: { rows: number; cols: number };
  options: LayoutOption[];
  keys: DefinitionKey[];
  customKeycodes: { name: string; title: string }[];
  extraFeatures: boolean;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min: number, max: number): v is number =>
  number(v, min, max) && Number.isInteger(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
function invalid(detail: string): never {
  throw new Error(`键盘定义无效：${detail}。`);
}
export const usbIdentity = (vid: number, pid: number) =>
  [vid, pid].map((n) => n.toString(16).toUpperCase().padStart(4, '0')).join(':');
export function viaModel(vid: number, pid: number): ModelId {
  if (vid === 0x36b0 && pid === 0x3021) return 'neo75cu';
  if (vid === 0x36b0 && pid === 0x3060) return 'neo65cu';
  return `via-${vid.toString(16).padStart(4, '0')}-${pid.toString(16).padStart(4, '0')}`;
}
export const validModel = (value: unknown): value is ModelId =>
  typeof value === 'string' &&
  (/^(?:via|zmk)-[0-9a-f]{4}-[0-9a-f]{4}$/.test(value) ||
    ['neo75cu', 'neo65cu', 'tofu-pad'].includes(value));

export function optionValues(options: LayoutOption[], packed: number): number[] {
  if (!integer(packed, 0, 0xffffffff)) invalid('配列选项超出范围');
  const values = Array<number>(options.length);
  let remaining = packed;
  for (let i = options.length - 1; i >= 0; i--) {
    const base = 2 ** Math.ceil(Math.log2(options[i].choices.length));
    values[i] = remaining % base;
    remaining = Math.floor(remaining / base);
    if (values[i] >= options[i].choices.length) invalid('配列选项不存在');
  }
  // Unused high bits can belong to vendor firmware. Preserve them on edits.
  return values;
}
export function setOption(
  options: LayoutOption[],
  packed: number,
  index: number,
  choice: number,
): number {
  optionValues(options, packed);
  if (
    !integer(index, 0, options.length - 1) ||
    !integer(choice, 0, options[index].choices.length - 1)
  )
    invalid('配列选项不存在');
  const shift = options
    .slice(index + 1)
    .reduce((n, o) => n + Math.ceil(Math.log2(o.choices.length)), 0);
  const base = 2 ** Math.ceil(Math.log2(options[index].choices.length));
  const previous = Math.floor(packed / 2 ** shift) % base;
  return packed + (choice - previous) * 2 ** shift;
}
export function definitionLayout(definition: ViaDefinition, packed = 0): PhysicalKey[] {
  const values = optionValues(definition.options, packed);
  const keys = definition.keys.filter(
    (k) => !k.decal && (!k.option || values[k.option[0]] === k.option[1]),
  );
  if (!keys.length || new Set(keys.map((k) => k.index)).size !== keys.length)
    invalid('当前配列含有重复或缺失的矩阵位置');
  return keys.map(({ option: _option, decal: _decal, ...key }) => ({ ...key }));
}
export const neoOptions: LayoutOption[] = [
  { label: '退格', choices: ['标准', '分裂'] },
  { label: '回车', choices: ['ANSI', 'ISO'] },
  { label: '左 Shift', choices: ['标准', '分裂'] },
  { label: '空格', choices: ['6.25U', '7U'] },
];
export function snapshotLayout(snapshot: DeviceSnapshot, options: number): PhysicalKey[] {
  if (snapshot.viaDefinition) return definitionLayout(snapshot.viaDefinition, options);
  if (snapshot.model === 'neo75cu' && integer(options, 0, 15)) return neoLayout(options);
  throw new Error('缺少对应的键盘定义。');
}
export const snapshotOptions = (snapshot: DeviceSnapshot): LayoutOption[] =>
  snapshot.viaDefinition?.options ?? (snapshot.model === 'neo75cu' ? neoOptions : []);

/** Parse the documented VIA/KLE data format; no expressions or custom-menu code are evaluated. */
export function parseViaDefinition(input: unknown): ViaDefinition {
  if (!record(input) || !text(input.name) || !record(input.matrix) || !record(input.layouts))
    invalid('请选择 VIA 键盘定义 JSON');
  const d = input as Record<string, unknown> & {
    name: string;
    matrix: Record<string, unknown>;
    layouts: Record<string, unknown>;
  };
  const id = (v: unknown) =>
    typeof v === 'string' && /^(?:0x)?[0-9a-f]{1,4}$/i.test(v.trim()) ? parseInt(v.trim(), 16) : v;
  const vendorId = id(d.vendorId),
    productId = id(d.productId);
  if (!integer(vendorId, 1, 65535) || !integer(productId, 0, 65535)) invalid('USB 编号不正确');
  const { rows, cols } = d.matrix;
  if (!integer(rows, 1, 32) || !integer(cols, 1, 32) || (rows as number) * (cols as number) > 512)
    invalid('矩阵尺寸超出范围');
  const labels = d.layouts.labels ?? [];
  if (!Array.isArray(labels) || labels.length > 16) invalid('配列选项超出范围');
  const options: LayoutOption[] = (labels as unknown[]).map((label) => {
    if (text(label)) return { label, choices: ['关闭', '开启'] };
    if (Array.isArray(label) && label.length >= 3 && label.length <= 17 && label.every(text))
      return { label: label[0], choices: label.slice(1) };
    return invalid('配列选项标签不正确');
  });
  if (options.reduce((sum, o) => sum + Math.ceil(Math.log2(o.choices.length)), 0) > 32)
    invalid('配列选项超过 32 位');
  const keymap = d.layouts.keymap;
  if (!Array.isArray(keymap) || keymap.length > 256) invalid('缺少物理配列');
  const keys: DefinitionKey[] = [];
  let x = 0,
    y = 0,
    rx = 0,
    ry = 0,
    rotation = 0;
  let extraFeatures = !!d.menus || (!!d.lighting && d.lighting !== 'none');
  for (const row of keymap as unknown[]) {
    if (record(row)) continue; // KLE document metadata, not a key row.
    if (!Array.isArray(row) || row.length > 1024) invalid('配列行不正确');
    let w = 1,
      h = 1,
      decal = false;
    for (const item of row as unknown[]) {
      if (record(item)) {
        for (const key of ['x', 'y', 'rx', 'ry', 'w', 'h', 'r'])
          if (
            item[key] !== undefined &&
            !number(item[key], key === 'r' ? -360 : -100, key === 'r' ? 360 : 100)
          )
            invalid('按键坐标不正确');
        if (item.r !== undefined) rotation = item.r as number;
        if (item.rx !== undefined) {
          rx = item.rx as number;
          x = rx;
          y = ry;
        }
        if (item.ry !== undefined) {
          ry = item.ry as number;
          x = rx;
          y = ry;
        }
        x += (item.x as number | undefined) ?? 0;
        y += (item.y as number | undefined) ?? 0;
        w = (item.w as number | undefined) ?? w;
        h = (item.h as number | undefined) ?? h;
        decal = (item.d as boolean | undefined) ?? decal;
        if (w <= 0 || h <= 0 || w > 16 || h > 8) invalid('键帽尺寸不正确');
        continue;
      }
      if (typeof item !== 'string' || item.length > 256 || keys.length >= 1024)
        invalid('按键标签不正确');
      const legends = item.split('\n');
      const address = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(legends[0]);
      const choice = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(legends[3] ?? '');
      if (/\be\d+\b/.test(item)) extraFeatures = true;
      if (!address && !decal && !/\be\d+\b/.test(item)) invalid('缺少按键矩阵位置');
      if (address || decal) {
        const r = address ? Number(address[1]) : 0,
          c = address ? Number(address[2]) : 0;
        if (r >= (rows as number) || c >= (cols as number)) invalid('按键超出矩阵范围');
        const option = choice
          ? ([Number(choice[1]), Number(choice[2])] as [number, number])
          : undefined;
        if (option && (!options[option[0]] || option[1] >= options[option[0]].choices.length))
          invalid('配列分组不存在');
        if (!number(x, -100, 100) || !number(y, -100, 100)) invalid('按键坐标超出范围');
        keys.push({
          id: `${r},${c}`,
          index: r * (cols as number) + c,
          row: r,
          col: c,
          x,
          y,
          w,
          h,
          ...(rotation ? { rotation, rx, ry } : {}),
          ...(option ? { option } : {}),
          ...(decal ? { decal: true } : {}),
        });
      }
      x += w;
      w = 1;
      h = 1;
      decal = false;
    }
    x = rx;
    y += 1;
  }
  // VIA alternatives may be placed outside the default drawing. Align each
  // alternative's bounding box with its own default group, including blockers.
  for (let group = 0; group < options.length; group++) {
    const sets = options[group].choices.map((_, value) =>
      keys.filter((k) => k.option?.[0] === group && k.option[1] === value),
    );
    if (!sets[0].length) invalid('配列缺少默认选项');
    // Some manufacturer definitions store indicator colors in layout bits and
    // attach only a decal to that option. Preserve the bits without inventing keys.
    if (sets.flat().every((k) => k.decal)) {
      extraFeatures = true;
      continue;
    }
    const origin = (set: DefinitionKey[]) => ({
      x: Math.min(...set.map((k) => k.x)),
      y: Math.min(...set.map((k) => k.y)),
    });
    const anchor = origin(sets[0]);
    for (const set of sets.slice(1)) {
      if (!set.length) invalid('配列缺少备选按键');
      const start = origin(set);
      for (const key of set) {
        key.x += anchor.x - start.x;
        key.y += anchor.y - start.y;
      }
    }
  }
  const custom = d.customKeycodes ?? [];
  if (!Array.isArray(custom) || custom.length > 128) invalid('自定义按键数量超出范围');
  const customKeycodes = (custom as unknown[]).map((k) => {
    if (
      !record(k) ||
      typeof k.name !== 'string' ||
      k.name.length > 256 ||
      (k.title !== undefined && (typeof k.title !== 'string' || k.title.length > 256))
    )
      return invalid('自定义按键标签不正确');
    return { name: k.name, title: typeof k.title === 'string' ? k.title : k.name };
  });
  const result: ViaDefinition = {
    version: 1,
    name: d.name,
    vendorId: vendorId as number,
    productId: productId as number,
    matrix: { rows: rows as number, cols: cols as number },
    options,
    keys,
    customKeycodes,
    extraFeatures,
  };
  definitionLayout(result);
  return result;
}

export function parseDefinitionFile(contents: string): ViaDefinition {
  if (contents.length > 2_000_000) throw new Error('键盘定义不能超过 2 MB。');
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new Error('无法解析 JSON 键盘定义。');
  }
  return parseViaDefinition(raw);
}

export function validateCompiledDefinition(value: unknown): ViaDefinition {
  if (
    !record(value) ||
    value.version !== 1 ||
    !text(value.name) ||
    !integer(value.vendorId, 1, 65535) ||
    !integer(value.productId, 0, 65535) ||
    !record(value.matrix)
  )
    return invalid('定义结构不正确');
  const { rows, cols } = value.matrix;
  if (!integer(rows, 1, 32) || !integer(cols, 1, 32) || rows * cols > 512)
    return invalid('矩阵尺寸超出范围');
  if (
    !Array.isArray(value.options) ||
    value.options.length > 16 ||
    value.options.some(
      (o) =>
        !record(o) ||
        !text(o.label) ||
        !Array.isArray(o.choices) ||
        o.choices.length < 2 ||
        o.choices.length > 16 ||
        !o.choices.every(text),
    )
  )
    return invalid('配列选项不正确');
  const options = value.options as LayoutOption[];
  if (options.reduce((sum, o) => sum + Math.ceil(Math.log2(o.choices.length)), 0) > 32)
    return invalid('配列选项超出范围');
  if (
    !Array.isArray(value.customKeycodes) ||
    value.customKeycodes.length > 128 ||
    value.customKeycodes.some(
      (k) =>
        !record(k) ||
        typeof k.name !== 'string' ||
        k.name.length > 256 ||
        typeof k.title !== 'string' ||
        k.title.length > 256,
    ) ||
    typeof value.extraFeatures !== 'boolean'
  )
    return invalid('设备功能不正确');
  if (!Array.isArray(value.keys) || !value.keys.length || value.keys.length > 1024)
    return invalid('物理配列不正确');
  for (const k of value.keys) {
    if (
      !record(k) ||
      !integer(k.row, 0, rows - 1) ||
      !integer(k.col, 0, cols - 1) ||
      k.id !== `${k.row},${k.col}` ||
      k.index !== k.row * cols + k.col ||
      !number(k.x, -100, 100) ||
      !number(k.y, -100, 100) ||
      !number(k.w, 0.05, 16) ||
      !number(k.h, 0.05, 8)
    )
      return invalid('按键坐标不正确');
    if (
      ['rotation', 'rx', 'ry'].some((n) => k[n] !== undefined && !number(k[n], -360, 360)) ||
      (k.decal !== undefined && typeof k.decal !== 'boolean')
    )
      return invalid('按键坐标不正确');
    if (
      k.option !== undefined &&
      (!Array.isArray(k.option) ||
        k.option.length !== 2 ||
        !integer(k.option[0], 0, options.length - 1) ||
        !integer(k.option[1], 0, options[k.option[0]].choices.length - 1))
    )
      return invalid('按键分组不正确');
  }
  const result = structuredClone(value) as unknown as ViaDefinition;
  definitionLayout(result);
  return result;
}
