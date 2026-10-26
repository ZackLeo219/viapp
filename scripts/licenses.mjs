import { createRequire } from 'node:module';
import { readFile, readdir, realpath, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = new Map();
const missing = [];
async function visit(name, from) {
  const require = createRequire(join(from, 'package.json'));
  let directory;
  try {
    directory = dirname(require.resolve(`${name}/package.json`));
  } catch {
    for (const location of require.resolve.paths(name) ?? []) {
      try {
        await access(join(location, name, 'package.json'));
        directory = join(location, name);
        break;
      } catch {}
    }
    if (!directory) throw new Error(`Cannot locate package ${name}`);
  }
  directory = await realpath(directory);
  if (packages.has(directory)) return;
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const names = (await readdir(directory))
    .filter((n) => /^(licen[sc]e|copying|notice)(\.|$|-)/i.test(n))
    .sort();
  const notices = await Promise.all(
    names.map(async (n) => `${n}\n${await readFile(join(directory, n), 'utf8')}`),
  );
  if (!notices.length) {
    try {
      notices.push(
        await readFile(
          join(root, 'third_party/licenses', name.replaceAll('/', '__') + '.txt'),
          'utf8',
        ),
      );
    } catch {
      missing.push(`${pkg.name}@${pkg.version} (${pkg.repository?.url ?? pkg.repository ?? ''})`);
    }
  }
  packages.set(
    directory,
    `${pkg.name}@${pkg.version} — ${pkg.license ?? 'See license'}\n${notices.join('\n\n')}`,
  );
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await visit(dependency, directory);
}
const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const name of Object.keys(project.dependencies)) await visit(name, root);
// Workbox runtime is emitted by the PWA build plugin.
const pwa = dirname(
  createRequire(join(root, 'package.json')).resolve('vite-plugin-pwa/package.json'),
);
const workbox = dirname(
  createRequire(join(pwa, 'package.json')).resolve('workbox-build/package.json'),
);
const workboxPackage = JSON.parse(await readFile(join(workbox, 'package.json'), 'utf8'));
for (const name of Object.keys(workboxPackage.dependencies).filter((n) => n.startsWith('workbox-')))
  await visit(name, workbox);
if (missing.length) throw new Error(`Missing upstream license texts:\n${missing.join('\n')}`);
const output = [
  'VIAPP\n' + (await readFile(join(root, 'LICENSE'), 'utf8')),
  'Third-party notices\nGenerated from the installed, locked dependency graph.\nSome additional Workbox notices are included conservatively.',
  ...[...packages.values()].sort(),
].join('\n\n' + '='.repeat(72) + '\n\n');
await writeFile(join(root, 'public/licenses.txt'), output + '\n');
console.log(`Collected license notices for ${packages.size} packages.`);
