import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary =
  process.platform === 'win32'
    ? 'viapp-windows-x64.exe'
    : process.platform === 'darwin'
      ? 'viapp-macos-arm64'
      : 'viapp-linux-x64';
const port = Number(process.argv[2] || 5178);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
const url = `http://127.0.0.1:${port}/`;
try {
  await fetch(url);
  throw new Error(`Port ${port} is already in use; close the existing launcher before testing.`);
} catch (e) {
  if (!(e instanceof TypeError)) throw e;
}
const launchArgs = ['-open=false', `-port=${port}`];
const child = spawn(resolve(root, 'release', binary), launchArgs, {
  stdio: 'ignore',
  windowsHide: true,
});
let exited = false;
const exit = new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', (code) => {
    exited = true;
    resolve(code);
  });
});
try {
  let response;
  for (let i = 0; i < 150 && !exited; i++) {
    try {
      response = await fetch(url);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(response, `Launcher did not start on port ${port}.`);
  assert.equal(response.headers.get('x-viapp-server'), '1');
  const html = await response.text();
  assert.ok(html.includes('VIAPP'));
  const entry = html.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(new URL(entry, url))).status, 200);
  assert.equal((await fetch(new URL('licenses.txt', url))).status, 200);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const second = spawn(resolve(root, 'release', binary), launchArgs, {
    stdio: 'ignore',
    windowsHide: true,
  });
  assert.equal(
    await new Promise((resolve, reject) => {
      second.on('error', reject);
      second.on('exit', resolve);
    }),
    0,
  );
  console.log(`PASS ${binary}: embedded webpage and licenses, duplicate launch, HTTP methods.`);
} finally {
  if (!exited) child.kill();
  await exit;
}
