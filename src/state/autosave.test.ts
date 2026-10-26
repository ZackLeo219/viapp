import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoDriver } from '../domain/demo';
import { clone } from '../domain/types';
import { isDirty, useWorkspace } from './workspace';
import { watchAutoSave } from './autosave';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), backup: vi.fn() }));
vi.mock('../protocols/via', () => ({ ViaDriver: { connect: mocks.connect } }));
vi.mock('./database', () => ({ saveProfile: mocks.backup }));
const state = () => useWorkspace.getState();
const flush = () => vi.advanceTimersByTimeAsync(400);
const a = { type: 'via' as const, code: 4 };
const b = { type: 'via' as const, code: 5 };
let driver: DemoDriver;
let stop: () => void;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useWorkspace.setState({ ...useWorkspace.getInitialState(), autoSave: true }, true);
  driver = new DemoDriver('neo75cu');
  mocks.connect.mockResolvedValue(driver);
  mocks.backup.mockResolvedValue(undefined);
  await state().connect('neo75cu');
  state().openDevice('neo75cu');
  stop = watchAutoSave();
});
afterEach(async () => {
  stop();
  useWorkspace.setState({ autoSave: false, autoSaving: false, operation: 'idle' });
  await state().disconnect();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('automatic device persistence', () => {
  it('never writes on connect; coalesces edits, backs up and verifies the saved result', async () => {
    const write = vi.spyOn(driver, 'writeBinding');
    const commit = vi.spyOn(driver, 'commit');
    const read = vi.spyOn(driver, 'read');
    await flush();
    expect(write).not.toHaveBeenCalled();
    const before = clone(state().baseline);
    state().edit(0, a);
    await vi.advanceTimersByTimeAsync(250);
    state().edit(0, b);
    await vi.advanceTimersByTimeAsync(250);
    expect(write).not.toHaveBeenCalled();
    await flush();
    expect(write).toHaveBeenCalledExactlyOnceWith(0, 0, b);
    expect(commit).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
    expect(mocks.backup).toHaveBeenCalledWith(expect.any(String), before, 'backup');
    expect(state().baseline.layers[0].bindings[0]).toEqual(b);
    expect(isDirty(state())).toBe(false);
    expect(state().autoSaveBlocked).toBe(false);
  });
  it('preserves edits made during a write and serializes a second verified save', async () => {
    const originalWrite = driver.writeBinding.bind(driver);
    let release!: () => void;
    const write = vi.spyOn(driver, 'writeBinding').mockImplementationOnce(async (...args) => {
      await originalWrite(...args);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    state().edit(0, a);
    await flush();
    expect(state().autoSaving).toBe(true);
    state().edit(0, b);
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(state().draft.layers[0].bindings[0]).toEqual(b);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().baseline.layers[0].bindings[0]).toEqual(a);
    expect(state().draft.layers[0].bindings[0]).toEqual(b);
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(state().baseline.layers[0].bindings[0]).toEqual(b);
    expect(isDirty(state())).toBe(false);
  });
  it('undoes and redoes an already saved edit on the device', async () => {
    const before = clone(state().baseline.layers[0].bindings[0]);
    state().edit(0, a);
    await flush();
    state().undo();
    await flush();
    expect((await driver.read()).layers[0].bindings[0]).toEqual(before);
    state().redo();
    await flush();
    expect((await driver.read()).layers[0].bindings[0]).toEqual(a);
    expect(isDirty(state())).toBe(false);
  });
  it('does not switch targets or reread while an automatic transaction is pending', async () => {
    state().edit(0, a);
    state().setPage('devices');
    expect(state().page).toBe('keymap');
    expect(await state().connect('tofu-pad', true)).toBe(false);
    await state().refresh();
    expect(state().draft.layers[0].bindings[0]).toEqual(a);
    await state().disconnect();
    expect(state().connection).toBe('device');
    await flush();
    state().setPage('devices');
    expect(state().page).toBe('devices');
  });
  it('requires confirmation for loaded configurations, including edits after loading', async () => {
    const write = vi.spyOn(driver, 'writeBinding');
    const imported = clone(state().baseline);
    imported.layers[0].bindings[0] = a;
    state().loadProfile(imported);
    state().edit(1, b);
    state().setAutoSave(false);
    state().setAutoSave(true);
    await flush();
    expect(write).not.toHaveBeenCalled();
    expect(state().requiresReview).toBe(true);
    await state().apply();
    expect(write).toHaveBeenCalledTimes(2);
    expect(isDirty(state())).toBe(false);
    expect(state().requiresReview).toBe(false);
  });
  it('cannot undo a discarded import to bypass confirmation', async () => {
    const write = vi.spyOn(driver, 'writeBinding');
    const imported = clone(state().baseline);
    imported.layers[0].bindings[0] = a;
    state().loadProfile(imported);
    state().resetDraft();
    state().undo();
    await flush();
    expect(write).not.toHaveBeenCalled();
    expect(isDirty(state())).toBe(false);
  });
  it('loading the saved configuration clears the review barrier without leaving imported history', async () => {
    const original = clone(state().baseline);
    const imported = clone(original);
    imported.layers[0].bindings[0] = a;
    state().loadProfile(imported);
    state().loadProfile(original);
    expect(state().requiresReview).toBe(false);
    state().undo();
    await flush();
    expect(isDirty(state())).toBe(false);
    state().edit(0, b);
    await flush();
    expect(state().baseline.layers[0].bindings[0]).toEqual(b);
  });
  it('does not restore stale lock metadata when undoing', async () => {
    state().edit(0, a);
    await flush();
    useWorkspace.setState((s) => ({
      baseline: { ...s.baseline, locked: true },
      draft: { ...s.draft, locked: true },
    }));
    const write = vi.spyOn(driver, 'writeBinding');
    state().undo();
    expect(state().draft.locked).toBe(true);
    await flush();
    expect(write).not.toHaveBeenCalled();
  });
  it('refuses writes when the backup cannot be saved', async () => {
    mocks.backup.mockRejectedValueOnce(new Error('Storage full'));
    const write = vi.spyOn(driver, 'writeBinding');
    state().edit(0, a);
    await flush();
    expect(write).not.toHaveBeenCalled();
    expect(state().autoSaveBlocked).toBe(true);
    expect(state().error).toContain('Storage full');
    expect(isDirty(state())).toBe(true);
  });
  it('stops after a partial write failure, preserves edits, and recovers through a fresh read', async () => {
    const originalWrite = driver.writeBinding.bind(driver);
    const write = vi.spyOn(driver, 'writeBinding').mockImplementationOnce(async (...args) => {
      await originalWrite(...args);
      throw new Error('USB write failed');
    });
    state().edit(0, a);
    await flush();
    expect(state().autoSaveBlocked).toBe(true);
    expect(state().error).toContain('USB write failed');
    state().edit(0, b);
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(state().draft.layers[0].bindings[0]).toEqual(b);
    await state().refresh();
    expect(mocks.backup).toHaveBeenCalledWith(
      expect.stringContaining('读取前草稿'),
      expect.anything(),
      'draft',
    );
    expect(state().autoSaveBlocked).toBe(false);
    expect(state().draft.layers[0].bindings[0]).toEqual(a);
    state().edit(0, b);
    await flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(isDirty(state())).toBe(false);
  });
  it('retains a failed verification as unsaved and does not retry automatically', async () => {
    const write = vi.spyOn(driver, 'writeBinding').mockResolvedValue(undefined);
    state().edit(0, a);
    await flush();
    expect(state().error).toContain('读回校验没有通过');
    expect(isDirty(state())).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('cancels queued writes when disabled and resumes only when explicitly enabled', async () => {
    const write = vi.spyOn(driver, 'writeBinding');
    state().edit(0, a);
    state().setAutoSave(false);
    await flush();
    expect(write).not.toHaveBeenCalled();
    expect(isDirty(state())).toBe(true);
    state().setAutoSave(true);
    await flush();
    expect(write).toHaveBeenCalledOnce();
    expect(isDirty(state())).toBe(false);
  });
  it('does not save an unchanged assignment or an edit undone within the debounce window', async () => {
    const write = vi.spyOn(driver, 'writeBinding');
    state().edit(0, clone(state().draft.layers[0].bindings[0]));
    await flush();
    state().edit(0, a);
    state().undo();
    await flush();
    expect(write).not.toHaveBeenCalled();
  });
  it('stops pending timers on cleanup, including React strict-mode remounts', async () => {
    const write = vi.spyOn(driver, 'writeBinding');
    state().edit(0, a);
    stop();
    await flush();
    expect(write).not.toHaveBeenCalled();
    stop = watchAutoSave();
    await flush();
    expect(write).toHaveBeenCalledOnce();
  });
});
