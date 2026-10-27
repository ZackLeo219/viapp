import neo65 from './neo65cu.json';
import neo75 from './neo75cu.json';
import catalog from './via-index.json';
import manufacturers from './manufacturer-index.json';
import {
  parseViaDefinition,
  usbIdentity,
  neoOptions,
  type ViaDefinition,
} from '../domain/via-definition';

export const VIA_USAGE = { usagePage: 0xff60, usage: 0x61 };
export const neo75Definition = parseViaDefinition(neo75);
const neo65Definition = parseViaDefinition(neo65);
neo75Definition.name = 'Neo75 Cu';
neo65Definition.name = 'Neo65 Cu';
neo65Definition.options = structuredClone(neoOptions);
const builtins = new Map([
  ['36B0:3021', neo75Definition],
  ['36B0:3060', neo65Definition],
]);
export interface DefinitionChoice {
  key: string;
  label: string;
  definition: unknown;
}
export class DefinitionRequired extends Error {
  constructor(
    message = '未找到键盘定义，请导入厂商提供的 VIA JSON。',
    readonly choices: DefinitionChoice[] = [],
  ) {
    super(message);
  }
}
export function hasViaInterface(device: HIDDevice): boolean {
  return device.collections.some(
    (c) => c.usagePage === VIA_USAGE.usagePage && c.usage === VIA_USAGE.usage,
  );
}
export const viaFilters: HIDDeviceFilter[] = [
  VIA_USAGE,
  ...[...new Set([...catalog.identities, ...manufacturers.identities, ...builtins.keys()])].map(
    (id) => {
      const [vendorId, productId] = id.split(':').map((n) => parseInt(n, 16));
      return { vendorId, productId };
    },
  ),
];
type Entry = { path: string; definition: unknown };
type Shard = Record<string, { v2: Entry[]; v3: Entry[] }>;
const loading = new Map<number, Promise<Shard>>();
const memory = new Map<string, unknown>();
type DeviceIdentity = Pick<HIDDevice, 'vendorId' | 'productId'> & { productName?: string };
const cacheKey = (id: string, productName = '') =>
  `viapp:via-definition:1:${id}:${encodeURIComponent(productName)}`;
export const hasDefinitionChoices = (id: string) => manufacturers.ambiguousIdentities.includes(id);
export function forgetDefinition(device: DeviceIdentity) {
  const id = usbIdentity(device.vendorId, device.productId);
  for (const key of [cacheKey(id, device.productName), `viapp:via-definition:1:${id}`]) {
    localStorage.removeItem(key);
    memory.delete(key);
  }
}
export function importDefinition(device: DeviceIdentity, raw: unknown): ViaDefinition {
  const definition = parseViaDefinition(raw);
  const id = usbIdentity(device.vendorId, device.productId);
  if (usbIdentity(definition.vendorId, definition.productId) !== id)
    throw new Error('这份 JSON 与当前键盘的 USB 编号不匹配。');
  if (builtins.has(id)) throw new Error('这台键盘已有内置定义，无需导入。');
  // Persist only validated source data; reparse it on every future load.
  try {
    localStorage.setItem(cacheKey(id, device.productName), JSON.stringify(raw));
  } catch {
    throw new Error('浏览器无法保存键盘定义，请检查存储权限或空间。');
  }
  memory.set(cacheKey(id, device.productName), raw);
  return definition;
}
type ManufacturerEntry = DefinitionChoice & { format: number; productName: string };
let manufacturerData: Promise<Record<string, ManufacturerEntry[]>> | undefined;
async function manufacturerDefinition(
  device: DeviceIdentity,
  version: number,
): Promise<ViaDefinition> {
  if (!manufacturerData) {
    manufacturerData = (async () => {
      const response = await fetch(
        `${import.meta.env.BASE_URL}definitions/manufacturers.json?rev=${manufacturers.revision}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error('无法加载原厂键盘定义。');
      return (await response.json()) as Record<string, ManufacturerEntry[]>;
    })();
    void manufacturerData.catch(() => {
      manufacturerData = undefined;
    });
  }
  let data: Record<string, ManufacturerEntry[]>;
  try {
    data = await manufacturerData;
  } catch {
    throw new DefinitionRequired('定义库暂时无法加载，可以重试或导入厂商 VIA JSON。');
  }
  const id = usbIdentity(device.vendorId, device.productId);
  const all = data[id];
  if (!Array.isArray(all) || !all.length) throw new DefinitionRequired();
  const format = version >= 11 ? 3 : 2;
  let entries = all.filter((e) => !e.format || e.format === format);
  if (!entries.length) entries = all;
  const normalized = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matched = entries.filter(
    (e) => normalized(e.productName) === normalized(device.productName ?? ''),
  );
  if (matched.length) entries = matched;
  // Validate every candidate before exposing a selection or touching a keymap.
  const parsed = entries.map((e) => {
    const definition = parseViaDefinition(e.definition);
    if (usbIdentity(definition.vendorId, definition.productId) !== id)
      throw new Error('原厂定义与 USB 编号不匹配。');
    return definition;
  });
  if (entries.length > 1)
    throw new DefinitionRequired(
      '这个 USB 编号对应多个 PCB 版本，请选择当前版本。',
      entries.map(({ key, label, definition }) => ({ key, label, definition })),
    );
  return parsed[0];
}
export async function resolveDefinition(
  device: Pick<HIDDevice, 'vendorId' | 'productId' | 'productName'>,
  version: number,
): Promise<ViaDefinition> {
  const id = usbIdentity(device.vendorId, device.productId);
  const builtin = builtins.get(id);
  if (builtin) return builtin;
  try {
    const key = cacheKey(id, device.productName);
    const raw =
      memory.get(key) ??
      JSON.parse(
        localStorage.getItem(key) ??
          (!hasDefinitionChoices(id)
            ? localStorage.getItem(`viapp:via-definition:1:${id}`)
            : null) ??
          'null',
      );
    if (raw) {
      const definition = parseViaDefinition(raw);
      if (usbIdentity(definition.vendorId, definition.productId) === id) return definition;
    }
  } catch {
    /* An invalid cached import must never override the catalog. */
  }
  if (manufacturers.identities.includes(id)) return manufacturerDefinition(device, version);
  if (!catalog.identities.includes(id)) throw new DefinitionRequired();
  const shardId = (device.vendorId ^ device.productId) & 63;
  let task = loading.get(shardId);
  if (!task) {
    task = (async () => {
      const response = await fetch(
        `${import.meta.env.BASE_URL}definitions/${shardId.toString(16).padStart(2, '0')}.json?rev=${catalog.revision}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error('无法加载键盘定义库。');
      return (await response.json()) as Shard;
    })();
    loading.set(shardId, task);
    void task.catch(() => loading.delete(shardId));
  }
  let data: Shard;
  try {
    data = await task;
  } catch {
    throw new DefinitionRequired('定义库暂时无法加载，可以重试或导入厂商 VIA JSON。');
  }
  const entry = data[id];
  let entries = (version >= 11 ? entry?.v3 : entry?.v2) ?? [];
  if (!entries.length) entries = (version >= 11 ? entry?.v2 : entry?.v3) ?? [];
  if (entries.length > 1) {
    const normalized = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    entries = entries.filter((e) => {
      const raw = e.definition as { name?: unknown };
      return (
        typeof raw.name === 'string' && normalized(raw.name) === normalized(device.productName)
      );
    });
  }
  if (entries.length !== 1)
    throw new DefinitionRequired('这个 USB 编号对应多份定义，请导入当前 PCB 的 VIA JSON。');
  try {
    const definition = parseViaDefinition(entries[0].definition);
    if (usbIdentity(definition.vendorId, definition.productId) !== id)
      throw new Error('USB mismatch');
    return definition;
  } catch {
    throw new DefinitionRequired('这份定义暂不能自动加载，请导入厂商提供的 VIA JSON。');
  }
}
