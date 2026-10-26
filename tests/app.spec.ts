import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __transitionFrame: { ready: boolean; animations: Animation[]; transition: ViewTransition };
  }
}

for (const width of [1536, 390]) {
  test(`keyboard transition has one visible image and preserves its shape at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await mockConnectedKeyboard(page);
    await page.goto('/');
    await expect(page.locator('.connected-card')).toHaveCount(1);
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (update) => {
        const transition = start(update);
        const frame = { ready: false, animations: [] as Animation[], transition };
        window.__transitionFrame = frame;
        void transition.ready.then(() => {
          frame.animations = document
            .getAnimations()
            .filter((animation) =>
              (animation.effect as KeyframeEffect)?.pseudoElement?.includes('view-transition'),
            );
          frame.animations.forEach((animation) => {
            animation.pause();
            animation.currentTime = 0;
          });
          frame.ready = true;
        });
        return transition;
      };
    });
    for (const direction of ['enter', 'return']) {
      if (direction === 'enter')
        await page.getByLabel('Neo75 Cu 开始配置', { exact: true }).click();
      else
        await page
          .getByRole('navigation', { name: '主导航' })
          .getByRole('button', { name: '设备中心', exact: true })
          .click();
      await page.waitForFunction(() => window.__transitionFrame.ready);
      for (const fraction of [0.25, 0.5, 0.75]) {
        const frame = await page.evaluate((fraction) => {
          const animations = window.__transitionFrame.animations;
          animations.forEach((animation) => {
            animation.currentTime = fraction * Number(animation.effect!.getTiming().duration);
          });
          const style = (pseudo: string) => getComputedStyle(document.documentElement, pseudo);
          const visible = (pseudo: string) => {
            const s = style(pseudo);
            return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01;
          };
          const group = style('::view-transition-group(keyboard-neo75cu)');
          const svg = document.querySelector<SVGSVGElement>('.keyboard-svg')!;
          const bounds = svg.viewBox.baseVal;
          return {
            animationCount: animations.length,
            visibleCopies: ['old', 'new'].filter((state) =>
              visible(`::view-transition-${state}(keyboard-neo75cu)`),
            ).length,
            oldPageVisible: visible('::view-transition-old(root)'),
            frameRatio: parseFloat(group.width) / parseFloat(group.height),
            drawingRatio: bounds.width / bounds.height,
          };
        }, fraction);
        expect(frame.animationCount).toBeGreaterThan(0);
        expect(frame.visibleCopies).toBe(1);
        expect(frame.oldPageVisible).toBe(false);
        expect(frame.frameRatio).toBeCloseTo(frame.drawingRatio, 2);
      }
      await page.evaluate(async () => {
        const { animations, transition } = window.__transitionFrame;
        animations.forEach((animation) => animation.finish());
        await transition.finished;
      });
    }
    await expect(page.locator('.connected-card')).toHaveCount(1);
    await expect(page.locator('.sidebar')).toHaveCount(0);
  });
}

for (const model of ['Neo75 Cu', 'TOFU PAD']) {
  test(`${model} saves ordinary edits by default and undo updates the device`, async ({ page }) => {
    await demo(page, model, true);
    await expect(page.getByRole('checkbox', { name: '自动保存', exact: true })).toBeChecked();
    const key = page
      .getByRole('group', { name: `${model} 基础层可视化键盘` })
      .locator('[data-key-index="0"]');
    const before = await key.getAttribute('aria-label');
    await key.click();
    await page.keyboard.press('a');
    await expect(key).toHaveAccessibleName(/^A，/);
    await expect(page.locator('.save-state')).toHaveText('演示配置已同步');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '撤销修改', exact: true }).click();
    await expect(page.locator('.save-state')).toHaveText('演示配置已同步');
    await expect(key).toHaveAccessibleName(before!);
    await page.getByRole('button', { name: '重做修改', exact: true }).click();
    await expect(page.locator('.save-state')).toHaveText('演示配置已同步');
    await page.getByRole('button', { name: '重新读取设备', exact: true }).click();
    await expect(key).toHaveAccessibleName(/^A，/);
    await page.getByRole('button', { name: '配置管理', exact: true }).click();
    await expect(page.locator('.profile-row')).toHaveCount(3);
  });
}

test('restoring a local backup requires confirmation even with automatic saving enabled', async ({
  page,
}) => {
  await demo(page, 'Neo75 Cu', true);
  await remapFirstKey(page);
  await expect(page.locator('.save-state')).toHaveText('演示配置已同步');
  await page.getByRole('button', { name: '配置管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本地配置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '载入配置', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('配置已载入，待确认保存');
  await page.waitForTimeout(700);
  await expect(page.locator('.save-state')).toHaveText('配置已载入，待确认保存');
  await expect(page.getByRole('checkbox', { name: '自动保存', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '保存演示配置', exact: true }).click();
  await page.getByTestId('confirm-save').click();
  await expect(page.locator('.save-state')).toHaveText('演示配置已同步');
  await page.getByRole('button', { name: '重新读取设备', exact: true }).click();
  await expect(page.locator('[data-key-index="0"]')).toHaveAccessibleName(/^Esc，/);
});

for (const mode of ['native', 'reduced', 'unsupported'] as const) {
  test(`device workspace transition navigates correctly with ${mode} motion support`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockConnectedKeyboard(page);
    await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    await page.goto('/');
    await expect(page.locator('.connected-card')).toHaveCount(1);
    await page.evaluate((mode) => {
      if (mode === 'unsupported') {
        Object.defineProperty(document, 'startViewTransition', {
          value: undefined,
          configurable: true,
        });
        return;
      }
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (update) => {
        document.documentElement.dataset.transitionStarted = '1';
        const transition = start(update);
        void transition.ready.then(() => {
          document.documentElement.dataset.transitionReady = '1';
        });
        void transition.finished.then(() => {
          document.documentElement.dataset.transitionFinished = '1';
        });
        return transition;
      };
    }, mode);
    await page.getByRole('button', { name: 'Neo75 Cu 开始配置', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Neo75 Cu 基础层可视化键盘' })).toBeVisible();
    if (mode === 'native') {
      await expect(page.locator('html')).toHaveAttribute('data-transition-ready', '1');
      await expect(page.locator('html')).toHaveAttribute('data-transition-finished', '1');
    } else await expect(page.locator('html')).not.toHaveAttribute('data-transition-started', '1');
    await page.getByRole('button', { name: '返回设备中心', exact: true }).click();
    await expect(page.locator('.connected-card')).toHaveCount(1);
    await expect(page.locator('.sidebar')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

async function mockConnectedKeyboard(page: Page) {
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
}

async function demo(page: Page, model = 'Neo75 Cu', autoSave = false) {
  await page.goto('/');
  await page.getByRole('button', { name: '体验演示' }).click();
  await page.getByRole('button', { name: `演示 ${model}`, exact: true }).click();
  await expect(page.locator('.connection-badge')).toHaveText('演示模式');
  if (!autoSave) await page.getByRole('checkbox', { name: '自动保存', exact: true }).uncheck();
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
  await page.getByRole('button', { name: '配置管理', exact: true }).click();
  await expect(page.locator('.profile-row')).toContainText('写入前备份');
  await page.getByRole('button', { name: '载入配置', exact: true }).click();
  await expect(page.locator('.save-state')).toContainText('待确认保存');
  expect(errors).toEqual([]);
});
test('profiles export and import without writing the device', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: '配置管理', exact: true }).click();
  await page.getByRole('textbox', { name: '配置名称' }).fill('我的办公方案');
  await page.getByRole('button', { name: '保存为新配置', exact: true }).click();
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
test('unfinished macros survive slot and page switches and remain separate from saved configuration', async ({
  page,
}) => {
  await demo(page, 'Neo75 Cu', true);
  await page.getByRole('button', { name: '宏编辑器', exact: true }).click();
  await page.getByRole('button', { name: '＋ 文本', exact: true }).click();
  await page.getByRole('textbox', { name: '动作 1 文本' }).fill('First macro');
  await page.locator('.macro-slots button').nth(1).click();
  await page.getByRole('button', { name: '＋ 按键', exact: true }).click();
  await page.getByRole('combobox', { name: '动作 1 类型' }).selectOption('down');
  await expect(page.locator('.save-state')).toHaveText('2 个宏尚未保存');
  await page.locator('.macro-slots button').nth(0).click();
  await expect(page.getByRole('textbox', { name: '动作 1 文本' })).toHaveValue('First macro');
  await page.getByRole('button', { name: '按键设置', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('2 个宏尚未保存');
  await page.getByRole('button', { name: '继续编辑宏', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '动作 1 文本' })).toHaveValue('First macro');
  await page.getByRole('button', { name: '保存宏', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('1 个宏尚未保存');
  await page.locator('.macro-slots button').nth(1).click();
  await expect(page.getByRole('combobox', { name: '动作 1 类型' })).toHaveValue('down');
  await page.getByRole('button', { name: '保存宏', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('释放');
  await expect(page.getByRole('combobox', { name: '动作 1 类型' })).toHaveValue('down');
  await page.getByRole('button', { name: '放弃编辑', exact: true }).click();
  await expect(page.locator('.save-state')).toHaveText('演示配置已同步');
  await page.getByRole('button', { name: '按键设置', exact: true }).click();
  await page.getByRole('button', { name: '重新读取设备', exact: true }).click();
  await page.getByRole('button', { name: '宏编辑器', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '动作 1 文本' })).toHaveValue('First macro');
});
test('unapplied macro input warns before closing and fits the narrow layout', async ({ page }) => {
  await demo(page, 'Neo75 Cu', true);
  await page.getByRole('button', { name: '宏编辑器', exact: true }).click();
  await page.getByRole('button', { name: '＋ 文本', exact: true }).click();
  await page.getByRole('textbox', { name: '动作 1 文本' }).fill('Keep on this page');
  const dialog = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const prompt = await dialog;
  expect(prompt.type()).toBe('beforeunload');
  await prompt.dismiss();
  expect(page.isClosed()).toBe(false);
  await expect(page.getByRole('textbox', { name: '动作 1 文本' })).toHaveValue('Keep on this page');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '按键设置', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '继续编辑宏', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '动作 1 文本' })).toHaveValue('Keep on this page');
});
test('help dialogs do not allow undo shortcuts to change the keyboard behind them', async ({
  page,
}) => {
  await demo(page);
  await remapFirstKey(page);
  await page.getByRole('button', { name: '连接帮助', exact: true }).click();
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.locator('[data-key-index="0"]')).toHaveAccessibleName(/^A，/);
  await expect(page.locator('.save-state')).toContainText('1 个按键');
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
test('a Shift event with no location automatically lights right Shift and stays independent of left Shift', async ({
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
  await page.evaluate(() => localStorage.setItem('viapp:tester-shift:neo75cu', 'Left'));
  await page.getByRole('button', { name: '按键测试', exact: true }).click();
  await unknownShift('keydown');
  await expect(page.locator('[data-test-code="ShiftRight"]')).toHaveAttribute('data-state', 'held');
  await expect(page.locator('[data-test-code="ShiftLeft"]')).toHaveAttribute(
    'data-state',
    'untested',
  );
  await unknownShift('keyup');
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
});
test('a device card disconnects independently without entering its workspace and can be reconnected', async ({
  page,
}) => {
  await mockConnectedKeyboard(page);
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
  for (const name of ['按键设置', '配置管理', '按键测试'])
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
  await expect(page.getByRole('button', { name: '配置管理', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '连接诊断', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '连接帮助', exact: true }).click();
  await expect(page.getByRole('heading', { name: '目前支持的型号' })).toBeVisible();
  await expect(page.locator('.help-models')).toContainText('Neo75 Cu');
  await expect(page.locator('.help-models')).toContainText('TOFU PAD');
  await expect(page.getByRole('heading', { name: 'Neo75 Cu', exact: true })).toHaveCount(0);
});
test('a serial open failure gives a recovery hint without claiming a connection or closing another owner', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const port = {
      getInfo: () => ({ usbVendorId: 0x9d5b, usbProductId: 0x2566 }),
      open: async () => {
        throw new DOMException(
          "Failed to execute 'open' on 'SerialPort': Failed to open serial port.",
          'NetworkError',
        );
      },
      close: async () => {
        document.documentElement.dataset.closedForeignPort = '1';
      },
    };
    const serial = Object.assign(new EventTarget(), {
      getPorts: async () => [port],
      requestPort: async () => port,
    });
    Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('关闭其他驱动页面');
  await expect(page.getByRole('alert')).not.toContainText('Failed to execute');
  await expect(page.locator('.connected-card')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-closed-foreign-port', '1');
  await expect(page.getByTestId('connect-serial')).toBeEnabled();
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.getByTestId('connect-serial').click();
  await expect(page.getByRole('alert')).toContainText('关闭其他驱动页面');
});
test('profiles belong to the selected keyboard and cannot import another model', async ({
  page,
}) => {
  await demo(page);
  await page.getByRole('button', { name: '配置管理', exact: true }).click();
  await page.getByRole('textbox', { name: '配置名称' }).fill('Neo only');
  await page.getByRole('button', { name: '保存为新配置', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Neo only', exact: true }).click();
  const profile = await download;
  const path = await profile.path();
  await page.getByLabel('返回设备中心', { exact: true }).click();
  await page.getByRole('button', { name: '体验演示', exact: true }).click();
  await page.getByRole('button', { name: '演示 TOFU PAD', exact: true }).click();
  await page.getByRole('button', { name: '配置管理', exact: true }).click();
  await expect(page.locator('.profile-row')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.getByRole('alert')).toContainText('此配置属于 Neo75 Cu');
  await expect(page.locator('.profile-row')).toHaveCount(0);
  await page.getByLabel('返回设备中心', { exact: true }).click();
  await page.getByRole('button', { name: '继续 Neo75 Cu 演示' }).click();
  await page.getByRole('button', { name: '配置管理', exact: true }).click();
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
  await expect(page.getByRole('group', { name: '录入目标按键' })).toBeFocused();
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
  await page.getByRole('button', { name: '录入按键', exact: true }).click();
  for (const type of ['keydown', 'keyup'])
    await page
      .getByRole('group', { name: '录入目标按键' })
      .dispatchEvent(type, { key: 'Shift', code: '', location: 0, shiftKey: type === 'keydown' });
  await expect(page.locator('.inspector-key')).toHaveText('R Shift');
});

for (const model of ['Neo75 Cu', 'TOFU PAD']) {
  test(`${model}: changing the capture target keeps the prompt and inspector steady`, async ({
    page,
  }) => {
    await demo(page, model);
    const board = page.getByRole('group', { name: `${model} 基础层可视化键盘` });
    const first = board.locator('[data-key-index="0"]');
    const second = board.locator('[data-key-index="1"]');
    const capture = page.getByRole('group', { name: '录入目标按键' });
    await first.click();
    await expect(capture).toBeFocused();
    const prompt = await capture.elementHandle();
    const searchY = (await page.locator('.search-field').boundingBox())!.y;
    const box = (await second.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Check between press and release, where blur previously removed the prompt.
    await expect(capture).toBeFocused();
    await page.mouse.up();
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(await capture.evaluate((node, original) => node === original, prompt)).toBe(true);
    await second.click();
    expect(await capture.evaluate((node, original) => node === original, prompt)).toBe(true);
    await page.keyboard.press('c');
    await expect(second).toHaveAccessibleName(/^C，/);
    await expect(page.getByRole('button', { name: '录入按键', exact: true })).toBeFocused();
    expect((await page.locator('.search-field').boundingBox())!.y).toBeCloseTo(searchY, 1);
    await second.click();
    expect(await capture.evaluate((node, original) => node === original, prompt)).toBe(true);
    expect((await page.locator('.search-field').boundingBox())!.y).toBeCloseTo(searchY, 1);
    await page.getByRole('textbox', { name: '搜索按键功能' }).fill('A');
    await expect(capture).toHaveCount(0);
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '设为 A', exact: true }).click();
    await expect(second).toHaveAccessibleName(/^A，/);
  });
  test(`${model}: clicking a key starts capture, including the same key again, without taking over search`, async ({
    page,
  }) => {
    await demo(page, model);
    const board = page.getByRole('group', { name: `${model} 基础层可视化键盘` });
    const first = board.locator('[data-key-index="0"]');
    const second = board.locator('[data-key-index="1"]');
    const capture = page.getByRole('group', { name: '录入目标按键' });
    await first.click();
    await expect(capture).toBeFocused();
    await page.keyboard.press('a');
    await expect(first).toHaveAccessibleName(/^A，/);
    await expect(page.getByRole('button', { name: '录入按键', exact: true })).toBeFocused();
    await page.keyboard.press('b');
    await expect(first).toHaveAccessibleName(/^A，/);
    await first.click();
    await expect(capture).toBeFocused();
    await page.keyboard.press('b');
    await expect(first).toHaveAccessibleName(/^B，/);
    await first.click();
    await second.click();
    await page.keyboard.press('c');
    await expect(second).toHaveAccessibleName(/^C，/);
    await expect(first).toHaveAccessibleName(/^B，/);
    await first.click();
    await page.getByRole('textbox', { name: '搜索按键功能' }).fill('A');
    await expect(capture).toHaveCount(0);
    await expect(first).toHaveAccessibleName(/^B，/);
    await page.getByRole('button', { name: '设为 A', exact: true }).click();
    await expect(first).toHaveAccessibleName(/^A，/);
    await expect(page.locator('.save-state')).toContainText('2 个按键');
    await page.getByRole('button', { name: '配置管理', exact: true }).click();
    await expect(page.locator('.profile-row')).toHaveCount(0);
  });
}

test('leaving the editor clears capture and selection without losing the edited binding', async ({
  page,
}) => {
  await demo(page);
  const first = page
    .getByRole('group', { name: 'Neo75 Cu 基础层可视化键盘' })
    .locator('[data-key-index="0"]');
  const capture = page.getByRole('group', { name: '录入目标按键' });
  const selected = page.locator('.keyboard-svg .key.selected');
  await first.click();
  await page.keyboard.press('a');
  await first.click();
  await page.locator('.editor-tip').click();
  await expect(capture).toHaveCount(0);
  await expect(selected).toHaveCount(0);
  await expect(page.getByText('选择一个按键', { exact: true })).toBeVisible();
  await page.keyboard.press('b');
  await expect(first).toHaveAccessibleName(/^A，/);
  await first.click();
  await expect(capture).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(selected).toHaveCount(0);
  await expect(capture).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.keyboard.press('c');
  await expect(first).toHaveAccessibleName(/^A，/);
  await expect(selected).toHaveCount(0);
  await first.click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(selected).toHaveCount(0);
  await expect(capture).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await first.click();
  await expect(capture).toBeFocused();
  await page.keyboard.press('d');
  await expect(first).toHaveAccessibleName(/^D，/);
});

test('keyboard navigation, layer changes and page changes do not accidentally restart capture', async ({
  page,
}) => {
  await demo(page);
  const board = page.getByRole('group', { name: 'Neo75 Cu 基础层可视化键盘' });
  const first = board.locator('[data-key-index="0"]');
  const second = board.locator('[data-key-index="1"]');
  const capture = page.getByRole('group', { name: '录入目标按键' });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(second).toBeFocused();
  await expect(capture).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(capture).toBeFocused();
  await expect(page.getByRole('button', { name: '保存演示配置', exact: true })).toBeDisabled();
  await page.keyboard.press('d');
  await expect(second).toHaveAccessibleName(/^D，/);
  await second.click();
  await page.getByRole('button', { name: '取消录入', exact: true }).click();
  await page.keyboard.press('e');
  await expect(second).toHaveAccessibleName(/^D，/);
  await second.click();
  await page.getByRole('tab', { name: '01 功能层 1', exact: true }).click();
  await expect(capture).toHaveCount(0);
  await page.getByRole('tab', { name: '00 基础层', exact: true }).click();
  await expect(capture).toHaveCount(0);
  await second.click();
  await page.getByRole('button', { name: '配置管理', exact: true }).click();
  await page.getByRole('button', { name: '按键设置', exact: true }).click();
  await expect(capture).toHaveCount(0);
  await expect(second).toHaveAccessibleName(/^D，/);
  await second.click();
  await expect(capture).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('.inspector-key')).toHaveText('Space');
  await expect(capture).toHaveCount(0);
});
