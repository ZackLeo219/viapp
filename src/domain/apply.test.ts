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

describe('layout and layer transactions', () => {
  it('saves a layout-only edit without changing matrix bindings', async () => {
    const driver = new DemoDriver('neo75cu'),
      before = await driver.read(),
      desired = clone(before);
    const { neoLayout } = await import('./layouts');
    desired.layoutOptions = 15;
    desired.keys = neoLayout(15);
    const backup = vi.fn(async () => {}),
      write = vi.spyOn(driver, 'writeBinding');
    const result = await applyConfiguration(driver, before, desired, backup);
    expect(result.layoutOptions).toBe(15);
    expect(result.layers).toEqual(before.layers);
    expect(backup).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });
  it('detects external renames before writing any keys', async () => {
    const driver = new DemoDriver('tofu-pad'),
      before = await driver.read(),
      desired = clone(before),
      external = clone(before.layers);
    external[1].name = 'Other';
    await driver.writeLayers(external);
    desired.layers[0].bindings[1] = { type: 'zmk', behaviorId: 1, param1: 0x70004, param2: 0 };
    const write = vi.spyOn(driver, 'writeBinding');
    await expect(applyConfiguration(driver, before, desired, async () => {})).rejects.toThrow(
      '其他工具',
    );
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects an unsupported rename before backup or writes', async () => {
    const driver = new DemoDriver('tofu-pad'),
      before = await driver.read(),
      desired = clone(before);
    desired.layers[1].name = 'Work';
    const write = vi.spyOn(driver, 'writeLayers'),
      backup = vi.fn(async () => {});
    await expect(applyConfiguration(driver, before, desired, backup)).rejects.toThrow('重命名');
    expect(write).not.toHaveBeenCalled();
    expect(backup).not.toHaveBeenCalled();
  });
  it('rejects dangling layer references before mutating a device', async () => {
    const driver = new DemoDriver('tofu-pad'),
      before = await driver.read(),
      desired = clone(before);
    desired.layers.pop();
    const write = vi.spyOn(driver, 'writeLayers');
    await expect(applyConfiguration(driver, before, desired, async () => {})).rejects.toThrow(
      '图层引用',
    );
    expect(write).not.toHaveBeenCalled();
  });
});

describe('manufacturer-specific bindings', () => {
  it('preserves opaque parameters on untouched original actions', async () => {
    const driver = new DemoDriver('tofu-pad');
    const before = await driver.read();
    before.behaviors.push({
      id: 99,
      name: 'Device_BT3',
      kind: 'other',
      parameterCount: 0,
      metadata: [{ param1: [], param2: [] }],
    });
    before.layers[1].bindings[0] = { type: 'zmk', behaviorId: 99, param1: 2, param2: 0 };
    const desired = clone(before);
    desired.layers[0].bindings[1] = { type: 'zmk', behaviorId: 1, param1: 0x70004, param2: 0 };
    vi.spyOn(driver, 'read').mockResolvedValueOnce(before).mockResolvedValueOnce(desired);
    const write = vi.spyOn(driver, 'writeBinding');
    await expect(applyConfiguration(driver, before, desired, async () => {})).resolves.toEqual(
      desired,
    );
    expect(write).toHaveBeenCalledExactlyOnceWith(0, 1, desired.layers[0].bindings[1]);
  });
});
