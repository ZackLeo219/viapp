import { test, expect, type Page } from '@playwright/test';
import type { RequestResponse } from '@zmkfirmware/zmk-studio-ts-client/studio';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { FrameDecoder, encodeFrame } from '../src/protocols/framing';

let Request: typeof import('@zmkfirmware/zmk-studio-ts-client/studio').Request;
let Response: typeof import('@zmkfirmware/zmk-studio-ts-client/studio').Response;
test.beforeAll(async () => {
  // The upstream browser package has extensionless imports, so load it with
  // the same resolver as the app instead of Node's native ESM resolver.
  const bundle = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(import.meta.resolve('@zmkfirmware/zmk-studio-ts-client/studio')),
        formats: ['es'],
      },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!('output' in result)) throw new Error('Expected one Studio test bundle');
  const chunk = result.output.find((entry) => entry.type === 'chunk' && entry.isEntry);
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing Studio test codec');
  ({ Request, Response } = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
  ));
});

// Exercise the production Web Serial transport with framed protobuf replies.
// These are protocol simulations, not claims of hardware acceptance.
async function fixture(page: Page, pid: number, name: string, keyCount: number) {
  const decoder = new FrameDecoder();
  const layers = [0, 1].map((id) => ({
    id,
    name: '',
    bindings: Array.from({ length: keyCount }, () => ({
      behaviorId: 7,
      param1: 0x70004,
      param2: 0,
    })),
  }));
  let unsaved = false;
  const writes: unknown[] = [];
  let commits = 0;
  await page.exposeFunction('__studioRequest', (bytes: number[]) => {
    return decoder.push(Uint8Array.from(bytes)).map((frame) => {
      const r = Request.decode(frame);
      const response: RequestResponse = { requestId: r.requestId };
      if (r.core?.getDeviceInfo)
        response.core = { getDeviceInfo: { name, serialNumber: Uint8Array.from([1, 2, 3]) } };
      else if (r.core?.getLockState) response.core = { getLockState: 1 };
      else if (r.keymap?.getKeymap)
        response.keymap = { getKeymap: { layers, availableLayers: 2, maxLayerNameLength: 20 } };
      else if (r.keymap?.getPhysicalLayouts)
        response.keymap = {
          getPhysicalLayouts: {
            activeLayoutIndex: 0,
            layouts: [
              {
                name: 'Stock',
                keys: Array.from({ length: keyCount }, (_, i) => ({
                  x: (i % 16) * 100,
                  y: Math.floor(i / 16) * 100,
                  width: 100,
                  height: 100,
                  r: 0,
                  rx: 0,
                  ry: 0,
                })),
              },
            ],
          },
        };
      else if (r.behaviors?.listAllBehaviors)
        response.behaviors = { listAllBehaviors: { behaviors: [7, 40] } };
      else if (r.behaviors?.getBehaviorDetails) {
        const id = r.behaviors.getBehaviorDetails.behaviorId;
        response.behaviors = {
          getBehaviorDetails: {
            id,
            displayName: id === 7 ? 'Key Press' : '_Trans',
            metadata:
              id === 7
                ? [
                    {
                      param1: [{ name: 'Key', hidUsage: { keyboardMax: 255, consumerMax: 4095 } }],
                      param2: [],
                    },
                  ]
                : [],
          },
        };
      } else if (r.keymap?.checkUnsavedChanges) response.keymap = { checkUnsavedChanges: unsaved };
      else if (r.keymap?.setLayerBinding) {
        const change = r.keymap.setLayerBinding;
        writes.push(change);
        layers[change.layerId].bindings[change.keyPosition] = change.binding!;
        unsaved = true;
        response.keymap = { setLayerBinding: 0 };
      } else if (r.keymap?.saveChanges) {
        commits++;
        unsaved = false;
        response.keymap = { saveChanges: { ok: true } };
      } else throw new Error(`Unexpected Studio request: ${JSON.stringify(r)}`);
      return [...encodeFrame(Response.encode({ requestResponse: response }).finish())];
    });
  });
  await page.addInitScript(
    ({ pid }) => {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      let granted = sessionStorage.getItem('studio-grant') === 'yes';
      let connected = true;
      const serial = new EventTarget();
      const port = {
        readable: null as ReadableStream<Uint8Array> | null,
        writable: null as WritableStream<Uint8Array> | null,
        get connected() {
          return connected;
        },
        getInfo: () => ({ usbVendorId: 0x9d5b, usbProductId: pid }),
        async open() {
          this.readable = new ReadableStream({
            start(c) {
              controller = c;
            },
          });
          this.writable = new WritableStream({
            async write(bytes: Uint8Array) {
              const frames = await (
                window as unknown as { __studioRequest(bytes: number[]): Promise<number[][]> }
              ).__studioRequest([...bytes]);
              for (const frame of frames) controller.enqueue(Uint8Array.from(frame));
            },
          });
        },
        async setSignals() {},
        async close() {
          this.readable = null;
          this.writable = null;
        },
      };
      Object.assign(serial, {
        getPorts: async () => (granted && connected ? [port] : []),
        requestPort: async (options: SerialPortRequestOptions) => {
          document.documentElement.dataset.serialFilters = JSON.stringify(options.filters);
          granted = true;
          sessionStorage.setItem('studio-grant', 'yes');
          return port;
        },
      });
      Object.assign(window, {
        __studioTest: {
          unplug() {
            connected = false;
            controller.close();
          },
          plug() {
            connected = true;
            serial.dispatchEvent(Object.assign(new Event('connect'), { port }));
          },
        },
      });
      Object.defineProperty(navigator, 'hid', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });
    },
    { pid },
  );
  return { writes, commits: () => commits };
}

for (const device of [
  { pid: 0x2566, name: 'Tofu Pad BLE (USB)', display: 'TOFU PAD', keys: 18 },
  { pid: 0x2562, name: 'Tofu60 BLE 3.0(USB)', display: 'TOFU60 3.0', keys: 61 },
  { pid: 0x2563, name: 'Tofu65 BLE 3.0(USB)', display: 'TOFU65 3.0', keys: 68 },
  { pid: 0x2564, name: 'Tofu TKL BLE v3.0', display: 'TOFU TKL', keys: 88 },
])
  test(`${device.display} Studio identifies, saves and reconnects through Web Serial`, async ({
    page,
  }) => {
    const firmware = await fixture(page, device.pid, device.name, device.keys);
    await page.goto('/');
    await page.getByTestId('connect-device').click();
    await page.getByTestId('connect-zmk').click();
    await page.getByRole('button', { name: `${device.display} 开始配置`, exact: true }).click();
    const keyboard = page.getByRole('group', { name: `${device.display} 基础层可视化键盘` });
    await expect(keyboard.locator('[data-key-index]')).toHaveCount(device.keys);
    expect(firmware.writes).toHaveLength(0);
    await keyboard.locator(`[data-key-index="${device.keys - 1}"]`).click();
    await page.getByRole('group', { name: '录入目标按键' }).press('b');
    await expect(page.locator('.save-bar')).toContainText('已保存到键盘');
    expect(firmware.writes).toEqual([
      {
        layerId: 0,
        keyPosition: device.keys - 1,
        binding: { behaviorId: 7, param1: 0x70005, param2: 0 },
      },
    ]);
    expect(firmware.commits()).toBe(1);
    await page.reload();
    await page.getByRole('button', { name: `${device.display} 开始配置`, exact: true }).click();
    await expect(page.locator(`[data-key-index="${device.keys - 1}"]`)).toHaveAttribute(
      'aria-label',
      /^B，/,
    );
    await page.evaluate(() =>
      (window as unknown as { __studioTest: { unplug(): void } }).__studioTest.unplug(),
    );
    await expect(page.locator('.connection-badge')).toHaveText('等待连接');
    await page.evaluate(() =>
      (window as unknown as { __studioTest: { plug(): void } }).__studioTest.plug(),
    );
    await expect(page.locator('.connection-badge')).toHaveText('USB 已连接');
    expect(firmware.writes).toHaveLength(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
