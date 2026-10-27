// Extract data, never application code, from a checked-out VIA keyboards revision.
// Usage: node scripts/sync-via-catalog.mjs /path/to/the-via/keyboards
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const root = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass the path to a VIA keyboards checkout.');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const shards = Array.from({ length: 64 }, () => ({}));
const identities = new Set();
let count = 0;
async function walk(path) {
  const entries = await readdir(join(root, path), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const file = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(file);
      continue;
    }
    if (!entry.name.endsWith('.json')) continue;
    const data = JSON.parse(await readFile(join(root, file), 'utf8'));
    if (!data.matrix || !data.layouts || !data.name) continue;
    const usbId = (v) => (typeof v === 'string' ? parseInt(v, 16) : v);
    const vid = usbId(data.vendorId),
      pid = usbId(data.productId);
    if (!Number.isInteger(vid) || !Number.isInteger(pid))
      throw new Error(`Invalid USB ID: ${file}`);
    const id = [vid, pid].map((n) => n.toString(16).toUpperCase().padStart(4, '0')).join(':');
    identities.add(id);
    const shard = shards[(vid ^ pid) & 63];
    const item = (shard[id] ??= { v2: [], v3: [] });
    const definition = Object.fromEntries(
      ['name', 'vendorId', 'productId', 'matrix', 'layouts', 'customKeycodes', 'menus', 'lighting']
        .filter((k) => data[k] !== undefined)
        .map((k) => [k, k === 'menus' ? Boolean(data[k]?.length) : data[k]]),
    );
    item[path.startsWith('v3') ? 'v3' : 'v2'].push({ path: file, definition });
    count++;
  }
}
await walk('src');
await walk('v3');
await mkdir('public/definitions', { recursive: true });
await mkdir('src/devices', { recursive: true });
for (const [index, shard] of shards.entries()) {
  const sorted = Object.fromEntries(
    Object.entries(shard).sort(([a], [b]) => a.localeCompare(b, 'en')),
  );
  await writeFile(
    `public/definitions/${index.toString(16).padStart(2, '0')}.json`,
    JSON.stringify(sorted) + '\n',
  );
}
await writeFile(
  'src/devices/via-index.json',
  JSON.stringify({ revision, identities: [...identities].sort() }, null, 2) + '\n',
);
await copyFile(join(root, 'LICENSE'), 'public/definitions/LICENSE.txt');
await writeFile(
  'public/definitions/SOURCE.txt',
  `VIA keyboard definition data (GPL-3.0).\nCopyright the VIA keyboard definition contributors.\nSource: https://github.com/the-via/keyboards/tree/${revision}\n\nVIAPP extracts identity, matrix, layout and custom-key data and groups it into USB-ID shards. Menus are represented only by a capability flag. This is data; no VIA application source is included. Reproduce with scripts/sync-via-catalog.mjs and the above revision. See LICENSE.txt for redistribution terms.\n`,
);
console.log(`${count} definitions, ${identities.size} USB identities, revision ${revision}`);
