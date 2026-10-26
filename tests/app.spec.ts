import { test, expect, type Page } from '@playwright/test';

async function demo(page: Page, model = 'Neo75 Cu') {
  await page.goto('/');
  await page.getByRole('button', { name: '体验演示' }).click();
  await page.getByRole('button', { name: `演示 ${model}`, exact: true }).click();
  await expect(page.locator('.connection-badge')).toHaveText('演示模式');
}
async function remapFirstKey(page: Page) {
  await page
    .getByRole('group', { name: 'Neo75 Cu 基础层可视化键盘' })
    .locator('[data-key-index="0"]')
    .click();
  await page.getByRole('textbox', { name: '搜索按键功能' }).fill('A');
  await page.getByRole('button', { name: '设为 A', exact: true }).click();
}
test('editor can remap, undo, redo, save with backup, and recover the backup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await demo(page);
  await remapFirstKey(page);
  await expect(page.locator('.save-state')).toContainText('1 个按键');
  await page.getByRole('button', { name: '撤销修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存演示配置', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重做修改', exact: true }).click();
  await page.getByRole('button', { name: '保存演示配置', exact: true }).click();
  await page.getByTestId('confirm-save').click();
  await expect(page.getByRole('status').filter({ hasText: '演示配置已更新' })).toBeVisible();
  await page.getByRole('button', { name: '我的方案', exact: true }).click();
  await expect(page.locator('.profile-row')).toContainText('写入前备份');
  await page.getByRole('button', { name: '载入草稿', exact: true }).click();
  await expect(page.locator('.save-state')).toContainText('1 个按键');
  expect(errors).toEqual([]);
});
test('profiles export and import without writing the device', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: '我的方案', exact: true }).click();
  await page.getByRole('textbox', { name: '方案名称' }).fill('我的办公方案');
  await page.getByRole('button', { name: '保存当前方案', exact: true }).click();
  await expect(page.locator('.profile-row')).toContainText('我的办公方案');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 我的办公方案', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain('viapp-neo75cu');
  await page.locator('input[type=file]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"viapp-profile","version":1,"name":"bad","snapshot":{}}'),
  });
  await expect(page.getByRole('alert')).toContainText('结构无效');
  await expect(page.locator('.profile-row')).toHaveCount(1);
});
test('macro editing validates text and saves a real sequence to the simulated device', async ({
  page,
}) => {
  await demo(page);
  await page.getByRole('button', { name: '宏编辑器', exact: true }).click();
  await page.getByRole('button', { name: '＋ 文本', exact: true }).click();
  await page.getByRole('textbox', { name: '动作 1 文本' }).fill('你好');
  await page.getByRole('button', { name: '应用到草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ASCII');
  await page.getByRole('textbox', { name: '动作 1 文本' }).fill('Hello');
  await page.getByRole('button', { name: '应用到草稿', exact: true }).click();
  await expect(page.locator('.save-state')).toContainText('1 个宏');
  await page.getByRole('button', { name: '保存演示配置', exact: true }).click();
  await page.getByTestId('confirm-save').click();
  await expect(page.getByRole('status').filter({ hasText: '演示配置已更新' })).toBeVisible();
});
test('TOFU uses its own behavior model and does not offer unsupported macro creation', async ({
  page,
}) => {
  await demo(page, 'TOFU PAD');
  await expect(page.getByRole('group', { name: 'TOFU PAD 基础层可视化键盘' })).toBeVisible();
  await page.getByRole('button', { name: '宏编辑器', exact: true }).click();
  await expect(page.getByRole('heading', { name: '当前固件不支持编辑宏' })).toBeVisible();
});
test('visual keyboard tracks presses, releases and distinct left/right keys', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await expect(page.locator('.tester-key')).toHaveCount(104);
  await page.keyboard.down('a');
  await expect(page.locator('[data-test-code="KeyA"]')).toHaveAttribute('data-state', 'held');
  await page.keyboard.down('a');
  await expect(page.getByTestId('press-count')).toHaveText('1');
  await page.keyboard.up('a');
  await expect(page.locator('[data-test-code="KeyA"]')).toHaveAttribute('data-state', 'tested');
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('ShiftRight');
  await expect(page.getByTestId('held-count')).toHaveText('2');
  await expect(page.locator('[data-test-code="ShiftLeft"]')).toHaveAttribute('data-state', 'held');
  await expect(page.locator('[data-test-code="ShiftRight"]')).toHaveAttribute('data-state', 'held');
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('ShiftRight');
  await page.keyboard.press('NumpadEnter');
  await expect(page.locator('[data-test-code="NumpadEnter"]')).toHaveAttribute(
    'data-state',
    'tested',
  );
  await expect(page.locator('[data-test-code="Enter"]')).toHaveAttribute('data-state', 'untested');
  await page.getByLabel('测试配列').selectOption('numpad');
  await expect(page.locator('.tester-key')).toHaveCount(17);
  await expect(page.getByTestId('tested-count')).toHaveText('1 / 17');
  await page.locator('[data-test-code="Numpad7"]').click();
  await expect(page.locator('[data-test-code="Numpad7"]')).toHaveAttribute(
    'data-state',
    'untested',
  );
  await page.getByRole('button', { name: '重新测试' }).click();
  await expect(page.getByTestId('press-count')).toHaveText('0');
  await expect(page.getByTestId('tested-count')).toHaveText('0 / 17');
});
test('tester supports Escape, releases keys on blur and permits keyboard exit', async ({
  page,
}) => {
  await demo(page);
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-test-code="Escape"]')).toHaveAttribute('data-state', 'tested');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '继续测试', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('group', { name: '可视化按键测试', exact: true })).not.toBeFocused();
  await page.getByRole('button', { name: '继续测试', exact: true }).click();
  await page.keyboard.down('a');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByTestId('held-count')).toHaveText('0');
  await expect(page.locator('[data-test-code="KeyA"]')).toHaveAttribute('data-state', 'tested');
  await page.keyboard.up('a');
  await page.getByRole('button', { name: '继续测试', exact: true }).click();
  await page.getByRole('button', { name: '连接帮助', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.tester-stage')).not.toHaveClass(/listening/);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续测试', exact: true })).toBeVisible();
});
test('tester starts on entry and keeps listening after clicking the page or the active navigation item', async ({
  page,
}) => {
  await demo(page);
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await page.keyboard.press('a');
  await expect(page.locator('[data-test-code="KeyA"]')).toHaveAttribute('data-count', '1');
  await page.locator('.tester-recent > span').click();
  await page.keyboard.press('b');
  await expect(page.locator('[data-test-code="KeyB"]')).toHaveAttribute('data-count', '1');
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await page.keyboard.press('ShiftRight');
  await expect(page.locator('[data-test-code="ShiftRight"]')).toHaveAttribute('data-count', '1');
  await page.getByLabel('测试配列').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-test-code="Home"]')).toHaveAttribute('data-state', 'untested');
  await page.getByRole('button', { name: '按键设置', exact: true }).click();
  await page.keyboard.press('c');
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await expect(page.getByTestId('press-count')).toHaveText('0');
  await page.keyboard.press('d');
  await expect(page.locator('[data-test-code="KeyD"]')).toHaveAttribute('data-count', '1');
  await page.keyboard.down('a');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByTestId('held-count')).toHaveText('0');
  await page.keyboard.up('a');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.keyboard.press('e');
  await expect(page.locator('[data-test-code="KeyE"]')).toHaveAttribute('data-state', 'untested');
});
test('a Shift event with no location is visible and can be calibrated without affecting normal left Shift', async ({
  page,
}) => {
  const unknownShift = async (type: 'keydown' | 'keyup') =>
    page.evaluate((eventType) => {
      window.dispatchEvent(
        new KeyboardEvent(eventType, {
          key: 'Shift',
          code: '',
          location: 0,
          keyCode: 16,
          shiftKey: eventType === 'keydown',
          bubbles: true,
          cancelable: true,
        }),
      );
    }, type);
  await demo(page);
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await unknownShift('keydown');
  await expect(page.getByTestId('held-keys')).toContainText('Shift · 未定位');
  for (const side of ['Left', 'Right'])
    await expect(page.locator(`[data-test-code="Shift${side}"]`)).toHaveAttribute(
      'data-state',
      'untested',
    );
  await unknownShift('keyup');
  await page.getByRole('button', { name: '右 Shift', exact: true }).click();
  await expect(page.locator('[data-test-code="ShiftRight"]')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('press-count')).toHaveText('1');
  await page.keyboard.down('ShiftLeft');
  await unknownShift('keydown');
  for (const side of ['Left', 'Right'])
    await expect(page.locator(`[data-test-code="Shift${side}"]`)).toHaveAttribute(
      'data-state',
      'held',
    );
  await unknownShift('keyup');
  await expect(page.locator('[data-test-code="ShiftRight"]')).toHaveAttribute(
    'data-state',
    'tested',
  );
  await expect(page.locator('[data-test-code="ShiftLeft"]')).toHaveAttribute('data-state', 'held');
  await page.keyboard.up('ShiftLeft');
  await expect(page.getByTestId('held-count')).toHaveText('0');
  await page.reload();
  await page.getByRole('button', { name: '体验演示', exact: true }).click();
  await page.getByRole('button', { name: '演示 Neo75 Cu', exact: true }).click();
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await unknownShift('keydown');
  await expect(page.locator('[data-test-code="ShiftRight"]')).toHaveAttribute('data-state', 'held');
  await unknownShift('keyup');
  await expect(page.getByRole('group', { name: '定位 Shift', exact: true })).toHaveCount(0);
  await page.getByText('测试说明', { exact: true }).click();
  await page.getByRole('button', { name: '重置 Shift 定位并重新测试', exact: true }).click();
  await unknownShift('keydown');
  await expect(page.getByRole('group', { name: '定位 Shift', exact: true })).toBeVisible();
  await unknownShift('keyup');
});
test('a device card disconnects independently without entering its workspace and can be reconnected', async ({
  page,
}) => {
  await page.addInitScript(() => {
    class KeyboardFixture extends EventTarget {
      vendorId = 0x36b0;
      productId = 0x3021;
      productName = 'NEO75';
      collections = [{ usagePage: 0xff60, usage: 0x61 }];
      opened = false;
      async open() {
        this.opened = true;
      }
      async close() {
        this.opened = false;
        document.documentElement.dataset.deviceClosed = '1';
      }
      async sendReport(_id: number, data: Uint8Array) {
        const response = new Uint8Array(data);
        if (data[0] === 1) response.set([0, 12], 1);
        else if (data[0] === 0x11) response[1] = 1;
        else if (![2, 0x12, 0x0c, 0x0d].includes(data[0])) throw new Error('Unexpected write');
        this.dispatchEvent(
          Object.assign(new Event('inputreport'), { data: new DataView(response.buffer) }),
        );
      }
    }
    const keyboard = new KeyboardFixture();
    const hid = Object.assign(new EventTarget(), {
      getDevices: async () => [keyboard],
      requestDevice: async () => [keyboard],
    });
    Object.defineProperty(navigator, 'hid', { value: hid, configurable: true });
  });
  await page.goto('/');
  await expect(page.locator('.connected-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Neo75 Cu 开始配置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '断开 Neo75 Cu', exact: true }).click();
  await expect(page.locator('.connected-card')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-device-closed', '1');
  await page.evaluate(() => navigator.hid.dispatchEvent(new Event('connect')));
  await expect(page.getByRole('heading', { name: '请连接设备', exact: true })).toBeVisible();
  await page.getByTestId('connect-device').click();
  await expect(page.locator('.connected-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Neo75 Cu 开始配置', exact: true }).click();
  await expect(page.locator('.connection-badge')).toHaveText('USB 已连接');
});
test('mobile layout remains usable without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '请连接设备', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.getByRole('button', { name: '体验演示' }).click();
  await page.getByRole('button', { name: '演示 Neo75 Cu', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Neo75 Cu 基础层可视化键盘' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('installed cache serves the application without network', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '请连接设备', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '请连接设备', exact: true })).toBeVisible();
  await context.setOffline(false);
});

test('home requests native permission without a model picker and keeps device tools inside', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const hid = new EventTarget();
    Object.assign(hid, {
      getDevices: async () => [],
      requestDevice: async () => {
        document.documentElement.dataset.permissionRequests = '1';
        return [];
      },
    });
    Object.defineProperty(navigator, 'hid', { value: hid, configurable: true });
  });
  await page.goto('/');
  await expect(page.locator('.connected-card')).toHaveCount(0);
  for (const name of ['按键设置', '我的方案', '按键测试'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.locator('.save-bar')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-permission-requests', '1');
  await page.getByTestId('connect-device').click();
  await expect(page.locator('html')).toHaveAttribute('data-permission-requests', '1');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.connected-card')).toHaveCount(0);
});

test('device switching keeps separate drafts and tester shortcuts do not undo configuration', async ({
  page,
}) => {
  await demo(page);
  await remapFirstKey(page);
  await page.getByLabel('返回设备中心', { exact: true }).click();
  await expect(page.locator('.connected-card')).toHaveCount(0);
  await page.getByRole('button', { name: '体验演示' }).click();
  await page.getByRole('button', { name: '演示 TOFU PAD', exact: true }).click();
  await expect(page.getByRole('group', { name: 'TOFU PAD 基础层可视化键盘' })).toBeVisible();
  await page.getByLabel('返回设备中心', { exact: true }).click();
  await page.getByRole('button', { name: '继续 Neo75 Cu 演示' }).click();
  await expect(page.locator('.save-state')).toContainText('1 个按键');
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.save-state')).toContainText('1 个按键');
});

test('home keeps device settings private to the workspace and help lists supported models', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '我的方案', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '连接诊断', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '连接帮助', exact: true }).click();
  await expect(page.getByRole('heading', { name: '目前支持的型号' })).toBeVisible();
  await expect(page.locator('.help-models')).toContainText('Neo75 Cu');
  await expect(page.locator('.help-models')).toContainText('TOFU PAD');
  await expect(page.getByRole('heading', { name: 'Neo75 Cu', exact: true })).toHaveCount(0);
});
test('profiles belong to the selected keyboard and cannot import another model', async ({
  page,
}) => {
  await demo(page);
  await page.getByRole('button', { name: '我的方案', exact: true }).click();
  await page.getByRole('textbox', { name: '方案名称' }).fill('Neo only');
  await page.getByRole('button', { name: '保存当前方案', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Neo only', exact: true }).click();
  const profile = await download;
  const path = await profile.path();
  await page.getByLabel('返回设备中心', { exact: true }).click();
  await page.getByRole('button', { name: '体验演示', exact: true }).click();
  await page.getByRole('button', { name: '演示 TOFU PAD', exact: true }).click();
  await page.getByRole('button', { name: '我的方案', exact: true }).click();
  await expect(page.locator('.profile-row')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.getByRole('alert')).toContainText('此方案属于 Neo75 Cu');
  await expect(page.locator('.profile-row')).toHaveCount(0);
  await page.getByLabel('返回设备中心', { exact: true }).click();
  await page.getByRole('button', { name: '继续 Neo75 Cu 演示' }).click();
  await page.getByRole('button', { name: '我的方案', exact: true }).click();
  await expect(page.locator('.profile-row')).toContainText('Neo only');
});
test('tester scales to mobile, keeps coverage across layouts and uses Mac legends', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page);
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Mac', exact: true }).click();
  await expect(page.locator('[data-test-code="MetaLeft"]')).toContainText('⌘');
  await page.keyboard.press('a');
  for (const layout of ['compact', 'tkl', 'full']) {
    await page.getByLabel('测试配列').selectOption(layout);
    await expect(page.locator('[data-test-code="KeyA"]')).toHaveAttribute('data-state', 'tested');
  }
  await page.getByLabel('次数', { exact: true }).check();
  await expect(page.locator('[data-test-code="KeyA"] .tester-key-count')).toHaveText('1');
  await page.getByLabel('测试配列').selectOption('numpad');
  const board = await page.locator('.tester-keyboard').boundingBox();
  expect(board!.width).toBeLessThan(330);
});

test('key capture remaps a single key while rejecting unsupported chords without changing the draft', async ({
  page,
}) => {
  await demo(page);
  await expect(page.locator('.action-grid')).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Neo75 Cu 基础层可视化键盘' })
    .locator('[data-key-index="0"]')
    .click();
  await page.getByRole('button', { name: '录入按键', exact: true }).click();
  await page.keyboard.press('a');
  await expect(page.locator('.inspector-key')).toHaveText('A');
  await expect(page.locator('.save-state')).toContainText('1 个按键');
  await page.getByRole('button', { name: '录入按键', exact: true }).click();
  await page.keyboard.press('NumpadEnter');
  await expect(page.locator('.inspector-key')).toHaveText('Num Enter');
  await page.getByRole('button', { name: '录入按键', exact: true }).click();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('group', { name: '录入目标按键' })).toBeVisible();
  await expect(page.locator('.inspector-key')).toHaveText('Num Enter');
  await page.getByRole('button', { name: '取消录入', exact: true }).click();
  await page.getByRole('button', { name: '录入按键', exact: true }).click();
  await page.keyboard.press('ShiftRight');
  await expect(page.locator('.inspector-key')).toHaveText('R Shift');
  await page.getByRole('button', { name: '录入按键', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.inspector-key')).toHaveText('Esc');
  await expect(page.getByRole('button', { name: '保存演示配置', exact: true })).toBeDisabled();
});
