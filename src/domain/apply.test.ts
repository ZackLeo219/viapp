import { describe, expect, it, vi } from 'vitest';
import { DemoDriver } from './demo';
import { applyConfiguration } from './apply';
import { clone } from './types';

describe('verified configuration transaction', () => {
  it('backs up original values before writes and reads back after commit', async () => {
    const driver = new DemoDriver('neo75cu');
    const baseline = await driver.read(),
      desired = clone(baseline);
    desired.layers[0].bindings[0] = { type: 'via', code: 4 };
    const backup = vi.fn(async (current) => {
      expect(current.layers[0].bindings[0]).toEqual(baseline.layers[0].bindings[0]);
      expect((await driver.read()).layers[0].bindings[0]).toEqual(baseline.layers[0].bindings[0]);
    });
    const result = await applyConfiguration(driver, baseline, desired, backup);
    expect(result.layers[0].bindings[0]).toEqual({ type: 'via', code: 4 });
    expect(backup).toHaveBeenCalledOnce();
  });
  it('does not overwrite changes made by another application', async () => {
    const driver = new DemoDriver('neo75cu'),
      before = await driver.read(),
      draft = clone(before);
    await driver.writeBinding(0, 1, { type: 'via', code: 5 });
    draft.layers[0].bindings[0] = { type: 'via', code: 4 };
    const write = vi.spyOn(driver, 'writeBinding');
    await expect(applyConfiguration(driver, before, draft, async () => {})).rejects.toThrow(
      '其他工具',
    );
    expect(write).not.toHaveBeenCalled();
  });
  it('does not start writes when backup storage fails', async () => {
    const driver = new DemoDriver('neo75cu'),
      before = await driver.read(),
      draft = clone(before);
    draft.layers[0].bindings[0] = { type: 'via', code: 4 };
    const write = vi.spyOn(driver, 'writeBinding');
    await expect(
      applyConfiguration(driver, before, draft, async () => {
        throw new Error('Storage full');
      }),
    ).rejects.toThrow('Storage full');
    expect(write).not.toHaveBeenCalled();
  });
  it('never reports success when a device ignores writes', async () => {
    const driver = new DemoDriver('neo75cu'),
      before = await driver.read(),
      draft = clone(before);
    draft.layers[0].bindings[0] = { type: 'via', code: 4 };
    vi.spyOn(driver, 'writeBinding').mockResolvedValue();
    await expect(applyConfiguration(driver, before, draft, async () => {})).rejects.toThrow('校验');
  });
  it('stops after a partial failure and preserves its original backup', async () => {
    const driver = new DemoDriver('neo75cu'),
      before = await driver.read(),
      draft = clone(before);
    draft.layers[0].bindings[0] = { type: 'via', code: 4 };
    draft.layers[0].bindings[1] = { type: 'via', code: 5 };
    const write = driver.writeBinding.bind(driver);
    vi.spyOn(driver, 'writeBinding').mockImplementation(async (l, i, b) => {
      if (i === 1) throw new Error('Disconnected');
      await write(l, i, b);
    });
    const backup = vi.fn(async () => {}),
      commit = vi.spyOn(driver, 'commit');
    await expect(applyConfiguration(driver, before, draft, backup)).rejects.toThrow('Disconnected');
    expect(backup).toHaveBeenCalledWith(before);
    expect(commit).not.toHaveBeenCalled();
    expect((await driver.read()).layers[0].bindings[0]).toEqual({ type: 'via', code: 4 });
  });
  it('does not save a ZMK session with preexisting unsaved changes', async () => {
    const driver = new DemoDriver('tofu-pad'),
      before = await driver.read(),
      current = clone(before);
    current.firmwareUnsaved = true;
    vi.spyOn(driver, 'read').mockResolvedValue(current);
    await expect(applyConfiguration(driver, before, before, async () => {})).rejects.toThrow(
      '已有未保存',
    );
  });
});
