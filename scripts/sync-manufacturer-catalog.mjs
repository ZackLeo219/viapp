// Fetch pinned manufacturer data. No firmware, menus or scripts are executed.
// Optional --cache points to a directory of <first 12 SHA256 characters>.json files.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const manifest = JSON.parse(await readFile('src/devices/manufacturer-sources.json', 'utf8'));
const cache = process.argv.includes('--cache')
  ? process.argv[process.argv.indexOf('--cache') + 1]
  : undefined;
const data = {};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const source of manifest.sources) {
  let bytes;
  if (cache)
    bytes = await readFile(join(cache, source.sha256.slice(0, 12) + '.json')).catch(
      () => undefined,
    );
  if (!bytes) {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (digest(bytes) !== source.sha256)
    throw new Error(`Source changed; review before updating: ${source.url}`);
  const raw = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const ids = [raw.vendorId, raw.productId].map((v) =>
    typeof v === 'string' ? parseInt(v, 16) : v,
  );
  if (!ids.every((n) => Number.isInteger(n) && n >= 0 && n <= 65535) || !raw.matrix || !raw.layouts)
    throw new Error(`Invalid definition: ${source.key}`);
  const identity = ids.map((n) => n.toString(16).toUpperCase().padStart(4, '0')).join(':');
  const definition = Object.fromEntries(
    ['name', 'vendorId', 'productId', 'matrix', 'layouts', 'customKeycodes', 'menus', 'lighting']
      .filter((k) => raw[k] !== undefined)
      .map((k) => [
        k,
        k === 'name'
          ? source.name
          : k === 'menus'
            ? Boolean(raw[k]?.length)
            : k === 'lighting'
              ? raw[k] && raw[k] !== 'none'
                ? 'vendor'
                : 'none'
              : raw[k],
      ]),
  );
  (data[identity] ??= []).push({
    key: source.key,
    label: source.label,
    format: source.format,
    productName: raw.name,
    definition,
  });
}
const sorted = Object.fromEntries(
  Object.entries(data).sort(([a], [b]) => a.localeCompare(b, 'en')),
);
const contents = JSON.stringify(sorted) + '\n';
await mkdir('public/definitions', { recursive: true });
await writeFile('public/definitions/manufacturers.json', contents);
const ambiguousIdentities = Object.entries(sorted)
  .filter(([, entries]) =>
    [2, 3].some((format) => entries.filter((e) => !e.format || e.format === format).length > 1),
  )
  .map(([id]) => id);
await writeFile(
  'src/devices/manufacturer-index.json',
  JSON.stringify(
    {
      revision: digest(contents).slice(0, 16),
      identities: Object.keys(sorted),
      ambiguousIdentities,
    },
    null,
    2,
  ) + '\n',
);
await writeFile(
  'public/definitions/MANUFACTURER-SOURCES.txt',
  "Manufacturer-supplied keyboard definition data. Original rights remain with the suppliers; this data is not relicensed under VIAPP's MIT license or the VIA catalog GPL license.\nVIAPP extracts USB identities, physical layouts, matrix addresses and custom-key labels. Menus are reduced to a capability flag; no firmware or configuration programs are included.\nReproduce with scripts/sync-manufacturer-catalog.mjs and src/devices/manufacturer-sources.json.\n\n" +
    manifest.sources
      .map((s) => `${s.label}\nPage: ${s.sourcePage}\nData: ${s.url}\nSHA256: ${s.sha256}\n`)
      .join('\n'),
);
console.log(
  `${manifest.sources.length} manufacturer definitions, ${Object.keys(sorted).length} USB identities.`,
);
