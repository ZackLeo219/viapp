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
  await expect(page.getByRole('heading', { name: '使用固件已有的行为' })).toBeVisible();
});
test('keyboard tester releases keys and exits on Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await page.getByRole('button', { name: '开始测试', exact: true }).click();
  await page.keyboard.down('a');
  await expect(page.locator('.held-keys')).toContainText('KeyA');
  await page.keyboard.up('a');
  await expect(page.locator('.held-keys kbd')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '开始测试', exact: true })).toBeVisible();
});
test('mobile layout remains usable without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '设备中心', exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '设备中心', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '设备中心', exact: true })).toBeVisible();
  await context.setOffline(false);
});

test('device center has no pretend connected keyboards or configuration before connection', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.connected-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '按键设置', exact: true })).toHaveCount(0);
  await expect(page.locator('.save-bar')).toHaveCount(0);
  await page.getByTestId('connect-device').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '连接 Neo75 Cu', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
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
  await page.getByRole('button', { name: '开始测试', exact: true }).click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.save-state')).toContainText('1 个按键');
});
