import { test, expect, type Page } from '@playwright/test';

interface Device {
  vid: number;
  pid: number;
  name: string;
  rows: number;
  cols: number;
  layers?: number;
}
async function fixture(page: Page, devices: Device[], granted = true) {
  await page.addInitScript(
    ({ devices, granted }) => {
      const hid = new EventTarget();
      let authorized = granted || sessionStorage.getItem('via-test-granted') === '1';
      class Board extends EventTarget {
        opened = false;
        collections = [{ usagePage: 0xff60, usage: 0x61 }];
        vendorId: number;
        productId: number;
        productName: string;
        keymap: Uint8Array;
        layout = 0;
        plugged = true;
        constructor(readonly config: Device) {
          super();
          this.vendorId = config.vid;
          this.productId = config.pid;
          this.productName = config.name;
          const previous = sessionStorage.getItem(`keys:${config.pid}`);
          this.keymap = previous
            ? Uint8Array.from(JSON.parse(previous))
            : new Uint8Array(config.rows * config.cols * (config.layers ?? 2) * 2);
          if (!previous) for (let i = 1; i < this.keymap.length; i += 2) this.keymap[i] = 4;
        }
        async open() {
          if (this.opened || !this.plugged) throw new Error('Already open or disconnected');
          this.opened = true;
        }
        async close() {
          this.opened = false;
        }
        async sendReport(_id: number, data: Uint8Array) {
          const r = new Uint8Array(data);
          const view = new DataView(r.buffer);
          if (r[0] === 1) r.set([0, 12], 1);
          else if (r[0] === 0x11) r[1] = this.config.layers ?? 2;
          else if (r[0] === 2 && r[1] === 2) view.setUint32(2, this.layout);
          else if (r[0] === 3 && r[1] === 2) this.layout = view.getUint32(2);
          else if (r[0] === 0x12)
            r.set(this.keymap.slice(r[1] * 256 + r[2], r[1] * 256 + r[2] + r[3]), 4);
          else if (r[0] === 5 || r[0] === 4) {
            const offset = ((r[1] * this.config.rows + r[2]) * this.config.cols + r[3]) * 2;
            if (r[0] === 5) {
              this.keymap.set(r.slice(4, 6), offset);
              sessionStorage.setItem(`keys:${this.productId}`, JSON.stringify([...this.keymap]));
              document.documentElement.dataset.lastWrite = JSON.stringify({
                pid: this.productId,
                layer: r[1],
                row: r[2],
                col: r[3],
                code: view.getUint16(4),
              });
            } else r.set(this.keymap.slice(offset, offset + 2), 4);
          } else if (r[0] === 0x0c || r[0] === 0x0d || (r[0] === 2 && r[1] === 3)) {
            /* zero macros / no switches held */
          } else throw new Error(`Unexpected command ${r[0]}`);
          this.dispatchEvent(
            Object.assign(new Event('inputreport'), { data: new DataView(r.buffer), reportId: 0 }),
          );
        }
      }
      const boards = devices.map((d) => new Board(d));
      Object.assign(hid, {
        getDevices: async () => (authorized ? boards.filter((b) => b.plugged) : []),
        requestDevice: async () => {
          authorized = true;
          sessionStorage.setItem('via-test-granted', '1');
          return boards.filter((b) => b.plugged).slice(0, 1);
        },
      });
      Object.assign(window, {
        __viaTest: {
          unplug(pid: number) {
            const b = boards.find((b) => b.productId === pid)!;
            b.plugged = false;
            hid.dispatchEvent(Object.assign(new Event('disconnect'), { device: b }));
          },
          plug(pid: number) {
            const b = boards.find((b) => b.productId === pid)!;
            b.plugged = true;
            hid.dispatchEvent(Object.assign(new Event('connect'), { device: b }));
          },
        },
      });
      Object.defineProperty(navigator, 'hid', { value: hid, configurable: true });
      Object.defineProperty(navigator, 'serial', { value: undefined, configurable: true });
    },
    { devices, granted },
  );
}
const neo65: Device = { vid: 0x36b0, pid: 0x3060, name: 'Neo 65Cu', rows: 6, cols: 16, layers: 4 };
const custom: Device = { vid: 0xcafe, pid: 0xbeef, name: 'Custom Pad', rows: 2, cols: 3 };
const definition = {
  name: 'Custom Pad',
  vendorId: '0xCAFE',
  productId: '0xBEEF',
  matrix: { rows: 2, cols: 3 },
  layouts: {
    keymap: [
      ['0,0', '0,1', '0,2'],
      ['1,0', '1,1', '1,2'],
    ],
  },
};

test('Neo65 is discovered with its own layout, auto-saves the correct matrix position and reconnects', async ({
  page,
}) => {
  await fixture(page, [neo65], false);
  await page.goto('/');
  await expect(page.locator('.connected-card')).toHaveCount(0);
  await page.getByTestId('connect-device').click();
  await page.getByTestId('connect-via').click();
  await page.getByRole('button', { name: 'Neo65 Cu 开始配置', exact: true }).click();
  const keyboard = page.getByRole('group', { name: 'Neo65 Cu 基础层可视化键盘' });
  await expect(keyboard.locator('[data-key-index]')).toHaveCount(67);
  await keyboard.locator('[data-key-index="17"]').click();
  await page.getByRole('group', { name: '录入目标按键' }).press('b');
  await expect(page.locator('.save-bar')).toContainText('已保存到键盘');
  expect(
    await page.evaluate(() => JSON.parse(document.documentElement.dataset.lastWrite!)),
  ).toMatchObject({ pid: 0x3060, row: 1, col: 1, code: 5 });
  await page.reload();
  await page.getByRole('button', { name: 'Neo65 Cu 开始配置', exact: true }).click();
  await expect(page.locator('[data-key-index="17"]')).toHaveAttribute('aria-label', /B，位置 1,1/);
  await page.getByRole('button', { name: '设备设置', exact: true }).click();
  await expect(page.getByRole('group', { name: '空格', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设备中心', exact: true }).first().click();
  await page.getByRole('button', { name: '断开 Neo65 Cu' }).click();
  await expect(page.locator('.connected-card')).toHaveCount(0);
  await page.evaluate(() => {
    const api = (
      window as unknown as { __viaTest: { unplug(pid: number): void; plug(pid: number): void } }
    ).__viaTest;
    api.unplug(0x3060);
    api.plug(0x3060);
  });
  await expect(page.getByRole('button', { name: 'Neo65 Cu 开始配置', exact: true })).toBeVisible();
});

test('catalog-backed keyboard loads without a model picker or Neo-specific functions', async ({
  page,
}) => {
  await fixture(page, [{ vid: 0x5946, pid: 1, name: 'Claw44', rows: 8, cols: 6 }]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Claw44 开始配置', exact: true }).click();
  const keyboard = page.getByRole('group', { name: 'Claw44 基础层可视化键盘' });
  await expect(keyboard.locator('[data-key-index]')).toHaveCount(44);
  await keyboard.locator('[data-key-index="0"]').click();
  await page.getByRole('group', { name: '录入目标按键' }).press('c');
  await expect(page.locator('.save-bar')).toContainText('已保存到键盘');
  expect(
    await page.evaluate(() => JSON.parse(document.documentElement.dataset.lastWrite!)),
  ).toMatchObject({ pid: 1, row: 0, col: 0, code: 6 });
  await page.getByRole('button', { name: '设备设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '物理配列' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('missing definition can be imported once; mismatched JSON cannot reach hardware', async ({
  page,
}) => {
  await fixture(page, [custom]);
  await page.goto('/');
  await expect(page.locator('.definition-card')).toContainText('Custom Pad');
  const upload = page.getByLabel('导入 Custom Pad 键盘定义');
  await upload.setInputFiles({
    name: 'wrong.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...definition, productId: '0x0001' })),
  });
  await expect(page.getByRole('alert')).toContainText('不匹配');
  expect(await page.evaluate(() => document.documentElement.dataset.lastWrite)).toBeUndefined();
  await upload.setInputFiles({
    name: 'correct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(definition)),
  });
  await page.getByRole('button', { name: 'Custom Pad 开始配置', exact: true }).click();
  const keyboard = page.getByRole('group', { name: 'Custom Pad 基础层可视化键盘' });
  await expect(keyboard.locator('[data-key-index]')).toHaveCount(6);
  await keyboard.locator('[data-key-index="5"]').click();
  await page.getByRole('group', { name: '录入目标按键' }).press('d');
  await expect(page.locator('.save-bar')).toContainText('已保存到键盘');
  expect(
    await page.evaluate(() => JSON.parse(document.documentElement.dataset.lastWrite!)),
  ).toMatchObject({ row: 1, col: 2, code: 7 });
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Custom Pad 开始配置', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.definition-card')).toHaveCount(0);
});

for (const width of [1536, 390])
  test(`unknown keyboard card is usable at ${width}px alongside a connected board`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await fixture(page, [neo65, custom]);
    await page.goto('/');
    await expect(page.locator('.connected-card')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '导入 JSON', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '移除 Custom Pad', exact: true }).click();
    await expect(page.locator('.connected-card')).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Neo65 Cu 开始配置', exact: true }),
    ).toBeVisible();
  });
