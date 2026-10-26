// Read-only hardware UI acceptance: connect both original boards, switch sessions,
// edit a browser draft, verify isolation, and discard it. No configuration is sent.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Run this test using Windows Node.js.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.hardware-test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'viapp-ui-test-'));
const base = process.argv[2] || 'http://localhost:4173';
const browser = spawn(
  join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
  [
    '--force-renderer-accessibility',
    '--remote-debugging-port=9232',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    base,
  ],
  { stdio: 'ignore' },
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let ws,
  nextId = 1;
const pending = new Map();
const errors = [];
function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await pause(200);
  }
  throw new Error(
    `UI condition timed out: ${expression}. ${await evaluate('document.querySelector("[role=alert]")?.textContent')}`,
  );
}
async function click(selector) {
  if (
    !(await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e || e.disabled)return false;e.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()`,
    ))
  )
    throw new Error(`Cannot click ${selector}`);
}
try {
  let target;
  for (let i = 0; i < 80; i++) {
    try {
      target = (await (await fetch('http://127.0.0.1:9232/json/list')).json()).find(
        (t) => t.type === 'page' && t.url.startsWith(base),
      );
      if (target) break;
    } catch {}
    await pause(250);
  }
  if (!target) throw new Error('Test browser failed to start.');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data),
      p = pending.get(data.id);
    if (p) {
      pending.delete(data.id);
      clearTimeout(p.timer);
      data.error ? p.reject(new Error(JSON.stringify(data.error))) : p.resolve(data.result);
    }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
  };
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1536,
    height: 1040,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor('document.querySelector("h1")?.textContent === "设备中心"');
  if (
    await evaluate(
      'document.querySelectorAll(".connected-card").length || !!document.querySelector(".save-bar")',
    )
  )
    throw new Error('Fresh home has unexpected connected devices or editor controls.');
  let count = 0;
  for (const model of ['neo75cu', 'tofu-pad']) {
    await call('Page.bringToFront');
    await click(
      model === 'neo75cu' ? '[data-testid="connect-device"]' : '[data-testid="connect-serial"]',
    );
    const choice = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(root, 'scripts/select-device.ps1'),
        '-BrowserPid',
        String(browser.pid),
        '-Model',
        model,
        '-ProfilePath',
        profile,
      ],
      { timeout: 45000, windowsHide: true },
    );
    console.log(choice.stdout.trim());
    await waitFor(
      `document.querySelectorAll('.connected-card').length === ${++count} && !document.querySelector('[role=dialog]')`,
    );
    if ((await evaluate('document.querySelector("h1")?.textContent')) !== '设备中心')
      throw new Error('Connection should return to the device center.');
  }
  await evaluate('window.__viappBeforeReload = true');
  await call('Page.reload', { ignoreCache: true });
  await waitFor(
    '!window.__viappBeforeReload && document.querySelectorAll(".connected-card").length === 2',
  );
  if (await evaluate('!!document.querySelector("[role=dialog]")'))
    throw new Error('Automatic discovery unexpectedly requested a model.');
  await click('[aria-label="Neo75 Cu 开始配置"]');
  await waitFor('document.querySelector("h1")?.textContent === "Neo75 Cu"');
  await click('[role="group"] [data-key-index="0"]');
  await evaluate(
    '[...document.querySelectorAll(".category-list button")].find(b=>b.textContent.trim()==="字母数字").click()',
  );
  await click('[aria-label="设为 A"]');
  await waitFor('document.querySelector(".save-state")?.textContent.includes("1 个按键")');
  await click('[aria-label="返回设备中心"]');
  await click('[aria-label="TOFU PAD 开始配置"]');
  await waitFor('document.querySelector("h1")?.textContent === "TOFU PAD"');
  if (await evaluate('document.querySelector(".save-state")?.textContent.includes("1 个按键")'))
    throw new Error('Neo draft leaked into TOFU session.');
  await click('[aria-label="返回设备中心"]');
  await click('[aria-label="Neo75 Cu 开始配置"]');
  await waitFor('document.querySelector(".save-state")?.textContent.includes("1 个按键")');
  await evaluate(
    '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="撤销全部").click()',
  );
  await waitFor('document.querySelector(".save-state")?.textContent.includes("与设备配置一致")');
  await click('[aria-label="返回设备中心"]');
  await pause(300);
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, 'connected-devices.png'), Buffer.from(screenshot.data, 'base64'));
  if (errors.length) throw new Error(`Browser errors: ${errors.join(', ')}`);
  await writeFile(
    join(output, 'ui-results.json'),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        realDevices: 2,
        automaticReconnect: true,
        origin: base,
        connectionFirst: true,
        separateDrafts: true,
        returnedToCleanState: true,
        hardwareWrites: 0,
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Real browser UI verified: 2 connected devices, automatic reconnect after reload, isolated drafts, clean final state.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (ws?.readyState === WebSocket.OPEN) {
    await call('Browser.close').catch(() => {});
    ws.close();
  }
  browser.kill();
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error('Browser closed'));
  }
  await pause(600);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
