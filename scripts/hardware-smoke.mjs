// Windows-only hardware verification, using a separate Chrome profile and native browser APIs.
// Read-only by default. --write temporarily edits one binding and restores it in a finally block.
// --features verifies device-specific settings and restores active and reserved layers.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32')
  throw new Error('请用 Windows Node.js 运行，以访问 Windows 上的真实 USB 设备。');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(
  root,
  '.hardware-test-results',
  `hardware-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'viapp-browser-test-'));
const base = 'http://localhost:5179';
const browser = spawn(
  join(
    process.env.ProgramFiles || 'C:\\Program Files',
    'Google',
    'Chrome',
    'Application',
    'chrome.exe',
  ),
  [
    '--force-renderer-accessibility',
    '--remote-debugging-port=9231',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    base,
  ],
  { stdio: 'ignore' },
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let nextId = 1;
let selectedModel = 'neo75cu';
const pending = new Map();
function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 90000);
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
const report = [];
try {
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:9231/json/list')).json();
      target = targets.find((t) => t.type === 'page' && t.url.startsWith(base));
      if (target) break;
    } catch {}
    await pause(300);
  }
  if (!target) throw new Error('测试浏览器未能启动。');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.error) p.reject(new Error(JSON.stringify(data.error)));
      else p.resolve(data.result);
    } else if (data.method === 'DeviceAccess.deviceRequestPrompted') {
      const devices = data.params.devices;
      const device = devices.find((d) =>
        selectedModel === 'neo75cu'
          ? /neo ?75/i.test(d.name)
          : selectedModel === 'neo65cu'
            ? /neo ?65/i.test(d.name)
            : /tofu|串行|serial|COM3/i.test(d.name),
      );
      console.log('Device chooser:', devices.map((d) => d.name).join(', '));
      if (device)
        await call('DeviceAccess.selectPrompt', { id: data.params.id, deviceId: device.id }).catch(
          console.error,
        );
      else await call('DeviceAccess.cancelPrompt', { id: data.params.id }).catch(console.error);
    }
  };
  await call('Runtime.enable');
  await call('DeviceAccess.enable');
  for (let i = 0; i < 60; i++) {
    const ready = await evaluate(
      '({url:location.href, ready:document.readyState, app:!!document.getElementById("root")})',
    );
    if (ready.app && ready.ready === 'complete') break;
    if (i === 59) throw new Error(`网页未就绪：${JSON.stringify(ready)}`);
    await pause(500);
  }
  const onlyModel = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1];
  if (onlyModel && !['neo75cu', 'neo65cu', 'tofu-pad'].includes(onlyModel))
    throw new Error('Unknown test model.');
  for (const model of onlyModel ? [onlyModel] : ['neo75cu', 'tofu-pad']) {
    selectedModel = model;
    console.log(`Reading ${model} through browser USB API...`);
    console.log(
      'Page:',
      await evaluate(
        '({url:location.href,secure:isSecureContext,hid:!!navigator.hid,serial:!!navigator.serial})',
      ),
    );
    await evaluate(
      `import('${base}/src/protocols/${model !== 'tofu-pad' ? 'via' : 'zmk'}.ts').then(module=>{window.__hardwareModule=module})`,
    );
    console.log('Adapter module loaded.');
    await call('Page.bringToFront');
    const reading = evaluate(
      `(async()=>{ window.__hardwareDriver = await window.__hardwareModule.${model !== 'tofu-pad' ? 'ViaDriver' : 'ZmkDriver'}.connect(); window.__hardwareOriginal = await window.__hardwareDriver.read(); return window.__hardwareOriginal; })()`,
    );
    // Select only this test browser's native chooser through Windows accessibility.
    const chooser = promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(root, 'scripts', 'select-device.ps1'),
        '-BrowserPid',
        String(browser.pid),
        '-Model',
        model,
        '-ProfilePath',
        profile,
      ],
      { timeout: 45000, windowsHide: true },
    );
    chooser
      .then((r) => console.log(r.stdout.trim()))
      .catch((e) => console.error('Chooser:', e.message));
    const initial = await reading;
    await chooser;
    if (initial.model !== model)
      throw new Error('Selected hardware does not match requested model.');
    await writeFile(join(output, `${model}-original.json`), JSON.stringify(initial, null, 2));
    if (model === 'tofu-pad')
      await writeFile(
        join(output, 'zmk-metadata.json'),
        JSON.stringify(await evaluate('[...window.__hardwareDriver.metadata.values()]'), null, 2),
      );
    console.log(
      `${model}: ${initial.keys.length} keys, ${initial.layers.length} layers, protocol ${initial.protocolVersion}, locked=${initial.locked}`,
    );
    if (
      (process.argv.includes('--write') || process.argv.includes('--features')) &&
      (initial.locked || initial.firmwareUnsaved)
    )
      throw new Error('请先解锁设备，并在驱动中保存或撤销已有修改，再运行写入测试。');
    if (process.argv.includes('--features')) {
      const result = await evaluate(`(async()=>{
        const {verifyFeatures} = await import('/scripts/hardware-features.ts');
        return verifyFeatures(window.__hardwareDriver, window.__hardwareOriginal);
      })()`);
      console.log(`${model} feature verification:`, JSON.stringify(result));
      report.push({ model, mode: 'features', ...result });
      if (result.failure || !result.restored)
        throw new Error(`${model} failed feature verification`);
    }
    if (process.argv.includes('--write')) {
      const result = await evaluate(`(async()=>{
        const {sameConfiguration} = await import('/src/domain/apply.ts');
        const {equalBinding} = await import('/src/domain/types.ts');
        const driver = window.__hardwareDriver, original = window.__hardwareOriginal;
        const layer = original.layers.at(-1);
        const index = original.protocol==='via' ? Array.from({length:layer.bindings.length},(_,i)=>i).find(i=>!original.keys.some(k=>k.index===i)) : layer.bindings.length-1;
        if(index === undefined) throw new Error('No unused matrix position available for testing');
        const previous = structuredClone(layer.bindings[index]);
        const keyBehavior = original.behaviors.find(b=>b.kind==='key');
        const replacement = original.protocol==='via' ? {type:'via',code: previous.code===115 ? 114 : 115} : {type:'zmk',behaviorId:keyBehavior.id,param1:previous.param1===0x70004?0x70005:0x70004,param2:0};
        let writeVerified=false, restored=false, failure=null;
        try { await driver.writeBinding(layer.id,index,replacement); await driver.commit(); const changed=await driver.read(); writeVerified=equalBinding(changed.layers.find(l=>l.id===layer.id).bindings[index],replacement); if(!writeVerified)throw new Error('write readback mismatch'); }
        catch(e){failure=String(e)}
        finally { await driver.writeBinding(layer.id,index,previous); await driver.commit(); const after=await driver.read(); restored=sameConfiguration(original,after); if(!restored)throw new Error('RESTORE VERIFICATION FAILED'); }
        return {writeVerified,restored,failure,layerId:layer.id,keyIndex:index};
      })()`);
      console.log(`${model} write and restore:`, JSON.stringify(result));
      report.push({ model, mode: 'write-and-restore', ...result });
      if (!result.writeVerified || !result.restored || result.failure)
        throw new Error(`${model} failed hardware write test`);
      if (model !== 'tofu-pad' && process.argv.includes('--macros')) {
        const macros = await evaluate(`(async()=>{
          const {sameConfiguration} = await import('/src/domain/apply.ts');
          const driver=window.__hardwareDriver, original=window.__hardwareOriginal;
          const slot=original.macros.findIndex((m,i)=>m.length===0 && !original.layers.some(l=>l.bindings.some(b=>b.type==='via' && b.code===0x7700+i)));
          if(slot<0) return {skipped:'No empty, unassigned macro slot'};
          const changed=structuredClone(original.macros); changed[slot]=[86,73,65,80,80];
          let verified=false, restored=false, failure=null;
          try { await driver.writeMacros(changed); const read=await driver.read(); verified=JSON.stringify(read.macros)===JSON.stringify(changed); if(!verified)throw new Error('macro readback mismatch'); }
          catch(e){failure=String(e)}
          finally { await driver.writeMacros(original.macros); restored=sameConfiguration(original,await driver.read()); if(!restored)throw new Error('MACRO RESTORE VERIFICATION FAILED'); }
          return {verified,restored,failure,slot};
        })()`);
        console.log('Neo macro write and restore:', JSON.stringify(macros));
        report.push({ model, mode: 'macro-write-and-restore', ...macros });
        if (!macros.skipped && (!macros.verified || !macros.restored || macros.failure))
          throw new Error('Neo macro verification failed');
      }
    } else if (!process.argv.includes('--features'))
      report.push({
        model,
        mode: 'read-only',
        keys: initial.keys.length,
        layers: initial.layers.length,
      });
    await evaluate('window.__hardwareDriver.close()');
  }
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify({ testedAt: new Date().toISOString(), report }, null, 2),
  );
  console.log(
    process.argv.includes('--write') || process.argv.includes('--features')
      ? 'Hardware verification finished; original configurations restored.'
      : 'Read-only hardware verification finished.',
  );
} catch (error) {
  console.error(error);
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, 'failure.json'),
    JSON.stringify({ testedAt: new Date().toISOString(), error: String(error), report }, null, 2),
  );
  process.exitCode = 1;
} finally {
  if (ws?.readyState === WebSocket.OPEN) {
    await evaluate('window.__hardwareDriver?.close()').catch(() => {});
    await call('Browser.close').catch(() => {});
    ws.close();
  }
  browser.kill();
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error('Browser test ended'));
  }
  await pause(600);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
