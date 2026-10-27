import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoDriver } from '../domain/demo';
import { hasUnsavedDrafts, isAutoSavePending, isDirty, useWorkspace } from './workspace';
import { watchDevices } from './discovery';

const mocks = vi.hoisted(() => ({
  neo: vi.fn(),
  tofu: vi.fn(),
  backup: vi.fn(),
  request: vi.fn(),
  authorized: vi.fn(),
  identifyHid: vi.fn(),
  identifySerial: vi.fn(),
}));
vi.mock('../protocols/discovery', () => ({
  requestDeviceAccess: mocks.request,
  authorizedDevices: mocks.authorized,
  identifyHid: mocks.identifyHid,
  identifySerial: mocks.identifySerial,
}));
vi.mock('../protocols/via', () => ({ ViaDriver: { connect: mocks.neo } }));
vi.mock('../protocols/zmk', () => ({ ZmkDriver: { connect: mocks.tofu } }));
vi.mock('./database', () => ({ saveProfile: mocks.backup }));
class HardwareFixture extends DemoDriver {
  onDisconnect?: (reason: string) => void;
  async read() {
    const result = await super.read();
    result.identity = `TEST:${this.model}`;
    return result;
  }
}
const state = () => useWorkspace.getState();
beforeEach(() => {
  useWorkspace.setState({ ...useWorkspace.getInitialState(), autoSave: false }, true);
  vi.clearAllMocks();
  mocks.backup.mockResolvedValue(undefined);
  mocks.authorized.mockResolvedValue([]);
  mocks.identifyHid.mockReturnValue(null);
  mocks.identifySerial.mockReturnValue(null);
});
afterEach(async () => {
  for (const model of ['neo75cu', 'tofu-pad'] as const) {
    state().openDevice(model);
    await state().disconnect();
  }
  vi.unstubAllGlobals();
});

describe('device center and independent sessions', () => {
  it('never redirects a newly selected keyboard to a different connected unit of the same model', async () => {
    mocks.neo.mockResolvedValue(new HardwareFixture('neo75cu'));
    const first = {} as HIDDevice,
      second = {} as HIDDevice;
    expect(
      await state().connect('neo75cu', false, {
        access: { model: 'neo75cu', transport: 'hid', device: first },
      }),
    ).toBe(true);
    expect(
      await state().connect('neo75cu', false, {
        access: { model: 'neo75cu', transport: 'hid', device: second },
      }),
    ).toBe(false);
    expect(mocks.neo).toHaveBeenCalledTimes(1);
    expect(state().error).toContain('同型号');
    expect(state().sessions.neo75cu?.connection).toBe('device');
  });
  it('keeps unapplied macro input across pages and devices without scheduling a write', async () => {
    await state().connect('neo75cu', true);
    state().setAutoSave(true);
    state().stageMacro(0, [{ type: 'text', text: 'unfinished' }]);
    state().stageMacro(1, [{ type: 'down', key: 224 }]);
    expect(hasUnsavedDrafts(state())).toBe(true);
    expect(isDirty(state())).toBe(false);
    expect(isAutoSavePending(state())).toBe(false);
    state().setPage('profiles');
    state().setPage('devices');
    await state().connect('tofu-pad', true);
    expect(state().macroDrafts).toEqual({});
    expect(hasUnsavedDrafts(state())).toBe(true);
    state().openDevice('neo75cu');
    expect(state().macroDrafts[0]).toEqual([{ type: 'text', text: 'unfinished' }]);
    state().editMacro(0, []);
    expect(state().macroDrafts[0]).toBeUndefined();
    expect(state().macroDrafts[1]).toEqual([{ type: 'down', key: 224 }]);
    state().discardMacro(1);
    expect(hasUnsavedDrafts(state())).toBe(false);
  });
  it('preserves unfinished macro input when reconnecting the same device', async () => {
    mocks.neo.mockResolvedValue(new HardwareFixture('neo75cu'));
    await state().connect('neo75cu');
    state().stageMacro(0, [{ type: 'text', text: 'keep me' }]);
    await state().disconnect();
    await state().connect('neo75cu');
    expect(state().macroDrafts[0]).toEqual([{ type: 'text', text: 'keep me' }]);
    expect(hasUnsavedDrafts(state())).toBe(true);
  });
  it('shows configuration only after a successful connection and explicit device selection', async () => {
    expect(state().page).toBe('devices');
    expect(state().sessions).toEqual({});
    mocks.neo.mockResolvedValue(new HardwareFixture('neo75cu'));
    expect(await state().connect('neo75cu')).toBe(true);
    expect(state().page).toBe('devices');
    expect(state().workspaceOpen).toBe(false);
    expect(state().sessions.neo75cu?.connection).toBe('device');
    state().setPage('profiles');
    expect(state().workspaceOpen).toBe(false);
    expect(state().page).toBe('devices');
    state().openDevice('neo75cu');
    expect(state().page).toBe('keymap');
    expect(state().workspaceOpen).toBe(true);
  });
  it('keeps drafts and sends writes to the selected device only', async () => {
    const neo = new HardwareFixture('neo75cu'),
      tofu = new HardwareFixture('tofu-pad');
    mocks.neo.mockResolvedValue(neo);
    mocks.tofu.mockResolvedValue(tofu);
    await state().connect('neo75cu');
    state().openDevice('neo75cu');
    state().edit(0, { type: 'via', code: 4 });
    await state().connect('tofu-pad');
    state().openDevice('tofu-pad');
    state().edit(1, { type: 'zmk', behaviorId: 1, param1: 0x70005, param2: 0 });
    state().openDevice('neo75cu');
    expect(isDirty(state())).toBe(true);
    await state().apply();
    expect(state().error).toBeNull();
    expect((await neo.read()).layers[0].bindings[0]).toEqual({ type: 'via', code: 4 });
    expect((await tofu.read()).layers[0].bindings[1]).not.toEqual({
      type: 'zmk',
      behaviorId: 1,
      param1: 0x70005,
      param2: 0,
    });
    state().openDevice('tofu-pad');
    expect(isDirty(state())).toBe(true);
    expect(state().draft.layers[0].bindings[1]).toEqual({
      type: 'zmk',
      behaviorId: 1,
      param1: 0x70005,
      param2: 0,
    });
  });
  it('a cancelled second connection leaves the first device and its draft intact', async () => {
    mocks.neo.mockResolvedValue(new HardwareFixture('neo75cu'));
    mocks.tofu.mockRejectedValue(new DOMException('Cancelled', 'NotFoundError'));
    await state().connect('neo75cu');
    state().openDevice('neo75cu');
    state().edit(0, { type: 'via', code: 5 });
    expect(await state().connect('tofu-pad')).toBe(false);
    expect(state().connection).toBe('device');
    expect(state().model).toBe('neo75cu');
    expect(isDirty(state())).toBe(true);
    expect(state().sessions['tofu-pad']).toBeUndefined();
  });
  it('disconnecting an inactive device does not mark the active one as offline', async () => {
    const neo = new HardwareFixture('neo75cu');
    mocks.neo.mockResolvedValue(neo);
    mocks.tofu.mockResolvedValue(new HardwareFixture('tofu-pad'));
    await state().connect('neo75cu');
    await state().connect('tofu-pad');
    neo.onDisconnect?.('Cable disconnected');
    expect(state().connection).toBe('device');
    expect(state().sessions.neo75cu?.connection).toBe('offline');
  });
  it('disconnects one card without switching devices, closing the other driver or losing either draft', async () => {
    const neo = new HardwareFixture('neo75cu'),
      tofu = new HardwareFixture('tofu-pad');
    const closeNeo = vi.spyOn(neo, 'close'),
      closeTofu = vi.spyOn(tofu, 'close');
    mocks.neo.mockResolvedValue(neo);
    mocks.tofu.mockResolvedValue(tofu);
    await state().connect('neo75cu');
    state().edit(0, { type: 'via', code: 4 });
    await state().connect('tofu-pad');
    state().edit(0, { type: 'zmk', behaviorId: 1, param1: 0x70005, param2: 0 });
    state().setPage('devices');
    const tofuDraft = state().draft;
    const neoDraft = state().sessions.neo75cu!.draft;
    await state().disconnect('neo75cu');
    expect(closeNeo).toHaveBeenCalledOnce();
    expect(closeTofu).not.toHaveBeenCalled();
    expect(state().model).toBe('tofu-pad');
    expect(state().page).toBe('devices');
    expect(state().workspaceOpen).toBe(false);
    expect(state().connection).toBe('device');
    expect(state().draft).toEqual(tofuDraft);
    expect(state().sessions.neo75cu?.draft).toEqual(neoDraft);
    expect(state().sessions.neo75cu?.connection).toBe('offline');
    expect(state().autoConnectBlocked).toEqual(['neo75cu']);
    await state().disconnect('tofu-pad');
    expect(state().connection).toBe('offline');
    expect(state().sessions['tofu-pad']?.draft).toEqual(tofuDraft);
    expect(state().sessions['tofu-pad']?.connection).toBe('offline');
  });
  it('does not disconnect a card during an in-progress operation', async () => {
    const neo = new HardwareFixture('neo75cu');
    const close = vi.spyOn(neo, 'close');
    mocks.neo.mockResolvedValue(neo);
    await state().connect('neo75cu');
    useWorkspace.setState({ operation: 'saving' });
    await state().disconnect('neo75cu');
    expect(close).not.toHaveBeenCalled();
    expect(state().connection).toBe('device');
    useWorkspace.setState({ operation: 'idle' });
  });
  it('reconnecting the same unchanged device keeps a draft and archives it before use', async () => {
    const neo = new HardwareFixture('neo75cu');
    mocks.neo.mockResolvedValue(neo);
    await state().connect('neo75cu');
    state().edit(0, { type: 'via', code: 6 });
    await state().disconnect();
    await state().connect('neo75cu');
    expect(isDirty(state())).toBe(true);
    expect(state().draft.layers[0].bindings[0]).toEqual({ type: 'via', code: 6 });
    expect(mocks.backup).toHaveBeenCalledWith(
      expect.stringContaining('重连前草稿'),
      expect.anything(),
      'draft',
    );
  });
  it('waits for an offline serial driver to release its handle before opening its replacement', async () => {
    const old = new HardwareFixture('tofu-pad');
    const next = new HardwareFixture('tofu-pad');
    mocks.tofu.mockResolvedValueOnce(old).mockResolvedValueOnce(next);
    await state().connect('tofu-pad');
    old.onDisconnect?.('USB error');
    let release!: () => void;
    const close = vi.spyOn(old, 'close').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const reconnect = state().connect('tofu-pad', false, {
      access: { model: 'tofu-pad', transport: 'serial', port: {} as SerialPort },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.tofu).toHaveBeenCalledTimes(1);
    release();
    expect(await reconnect).toBe(true);
    expect(mocks.tofu).toHaveBeenCalledTimes(2);
    expect(state().connection).toBe('device');
    expect(state().error).toBeNull();
  });
  it('offline profile preview does not disconnect a different connected board', async () => {
    mocks.neo.mockResolvedValue(new HardwareFixture('neo75cu'));
    await state().connect('neo75cu');
    state().openDevice('neo75cu');
    state().edit(0, { type: 'via', code: 8 });
    state().loadProfile(await new HardwareFixture('tofu-pad').read());
    expect(state().model).toBe('tofu-pad');
    expect(state().connection).toBe('offline');
    expect(state().sessions.neo75cu?.connection).toBe('device');
    state().openDevice('neo75cu');
    expect(state().draft.layers[0].bindings[0]).toEqual({ type: 'via', code: 8 });
  });
  it('replacing an explicit demo with a real connection reads fresh hardware data', async () => {
    await state().connect('neo75cu', true);
    state().edit(0, { type: 'via', code: 9 });
    mocks.neo.mockResolvedValue(new HardwareFixture('neo75cu'));
    expect(await state().connect('neo75cu')).toBe(true);
    expect(state().connection).toBe('device');
    expect(state().workspaceOpen).toBe(false);
    expect(state().draft.identity).toBe('TEST:neo75cu');
    expect(isDirty(state())).toBe(false);
    expect(mocks.backup).toHaveBeenCalled();
  });
});

describe('automatic connection', () => {
  it.each(['neo75cu', 'tofu-pad'] as const)(
    '%s reconnects from its existing grant after a real plug event, including after manual disconnect',
    async (model) => {
      const hid = new EventTarget(),
        serial = new EventTarget();
      vi.stubGlobal('navigator', { hid, serial });
      const handle = { getInfo: () => ({}) };
      const access =
        model === 'neo75cu'
          ? { model, transport: 'hid', device: handle }
          : { model, transport: 'serial', port: handle };
      const connect = model === 'neo75cu' ? mocks.neo : mocks.tofu;
      const identify = model === 'neo75cu' ? mocks.identifyHid : mocks.identifySerial;
      identify.mockReturnValue(access);
      mocks.authorized.mockResolvedValue([access]);
      connect.mockImplementation(async () => new HardwareFixture(model));
      const stop = watchDevices();
      try {
        await vi.waitFor(() => expect(state().sessions[model]?.connection).toBe('device'));
        expect(state().page).toBe('devices');
        await state().disconnect(model);
        expect(state().autoConnectBlocked).toContain(model);
        const event = new Event('connect');
        // Current Web Serial events target the SerialPort; WebHID supplies device.
        Object.defineProperty(event, model === 'neo75cu' ? 'device' : 'target', { value: handle });
        (model === 'neo75cu' ? hid : serial).dispatchEvent(event);
        await vi.waitFor(() => expect(state().sessions[model]?.connection).toBe('device'));
        expect(state().autoConnectBlocked).not.toContain(model);
        expect(connect).toHaveBeenCalledTimes(2);
        expect(mocks.request).not.toHaveBeenCalled();
        expect(state().page).toBe('devices');
      } finally {
        stop();
      }
    },
  );
  it('adds a discovered board without navigating away or altering another draft', async () => {
    await state().connect('neo75cu', true);
    state().edit(0, { type: 'via', code: 4 });
    const before = state().draft;
    mocks.tofu.mockResolvedValue(new HardwareFixture('tofu-pad'));
    const port = {} as SerialPort;
    await state().connect('tofu-pad', false, {
      access: { model: 'tofu-pad', transport: 'serial', port },
      automatic: true,
    });
    expect(mocks.tofu).toHaveBeenCalledWith(port);
    expect(state().model).toBe('neo75cu');
    expect(state().page).toBe('keymap');
    expect(state().draft).toEqual(before);
    expect(state().sessions['tofu-pad']?.connection).toBe('device');
  });
  it('scans existing grants, avoids duplicate opens and respects manual disconnection', async () => {
    const bus = new EventTarget();
    vi.stubGlobal('navigator', { hid: bus, serial: new EventTarget() });
    const device = {} as HIDDevice;
    mocks.authorized.mockResolvedValue([{ model: 'neo75cu', transport: 'hid', device }]);
    mocks.neo.mockResolvedValue(new HardwareFixture('neo75cu'));
    const stop = watchDevices();
    try {
      await vi.waitFor(() => expect(state().sessions.neo75cu?.connection).toBe('device'));
      bus.dispatchEvent(new Event('connect'));
      await vi.waitFor(() => expect(mocks.authorized).toHaveBeenCalledTimes(2));
      expect(mocks.neo).toHaveBeenCalledTimes(1);
      await state().disconnect();
      bus.dispatchEvent(new Event('connect'));
      await vi.waitFor(() => expect(mocks.authorized).toHaveBeenCalledTimes(3));
      expect(mocks.neo).toHaveBeenCalledTimes(1);
      expect(state().autoConnectBlocked).toContain('neo75cu');
    } finally {
      stop();
    }
  });
  it('waits until a write finishes before opening newly discovered hardware', async () => {
    vi.stubGlobal('navigator', { hid: new EventTarget(), serial: new EventTarget() });
    useWorkspace.setState({ operation: 'saving' });
    mocks.authorized.mockResolvedValue([{ model: 'neo75cu', transport: 'hid', device: {} }]);
    mocks.neo.mockResolvedValue(new HardwareFixture('neo75cu'));
    const stop = watchDevices();
    try {
      await Promise.resolve();
      expect(mocks.neo).not.toHaveBeenCalled();
      useWorkspace.setState({ operation: 'idle' });
      await vi.waitFor(() => expect(state().sessions.neo75cu?.connection).toBe('device'));
    } finally {
      stop();
    }
  });
  it('identifies the selected device from its grant, including serial devices', async () => {
    const port = {} as SerialPort;
    mocks.request.mockResolvedValue({ model: 'tofu-pad', transport: 'serial', port });
    mocks.tofu.mockResolvedValue(new HardwareFixture('tofu-pad'));
    expect(await state().authorize('serial')).toBe(true);
    expect(state().model).toBe('tofu-pad');
    expect(state().page).toBe('devices');
    expect(mocks.tofu).toHaveBeenCalledWith(port);
  });
});

describe('device settings', () => {
  it('does not discard preexisting firmware changes when adding a layer is blocked', async () => {
    const driver = Object.assign(new HardwareFixture('tofu-pad'), {
      discardChanges: vi.fn(async () => {}),
    });
    mocks.tofu.mockResolvedValue(driver);
    await state().connect('tofu-pad');
    state().openDevice('tofu-pad');
    const external = await driver.read();
    external.firmwareUnsaved = true;
    vi.spyOn(driver, 'read').mockResolvedValue(external);
    const discard = vi.spyOn(driver, 'discardChanges'),
      add = vi.spyOn(driver, 'addLayer');
    await state().addLayer();
    expect(state().error).toContain('设备配置已变化');
    expect(add).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });
  it('keeps layout edits undoable and can restore a different layout from backup', async () => {
    await state().connect('neo75cu', true);
    const original = structuredClone(state().baseline);
    state().setLayout(8);
    expect(isDirty(state())).toBe(true);
    expect(state().draft.keys.length).toBe(original.keys.length + 1);
    state().undo();
    expect(state().draft.layoutOptions).toBe(0);
    state().redo();
    await state().apply();
    state().loadProfile(original);
    expect(state().requiresReview).toBe(true);
    await state().apply();
    expect(state().baseline.layoutOptions).toBe(0);
  });
  it('copies a layer as a reviewable batch, preserving other layers', async () => {
    await state().connect('neo75cu', true);
    state().setAutoSave(true);
    const original = structuredClone(state().baseline);
    state().copyLayer(0, 2);
    expect(state().draft.layers[2].bindings).toEqual(original.layers[0].bindings);
    expect(state().draft.layers[1]).toEqual(original.layers[1]);
    expect(state().requiresReview).toBe(true);
    expect(isAutoSavePending(state())).toBe(false);
  });
  it('adds a reserved layer and rejects referenced deletions', async () => {
    await state().connect('tofu-pad', true);
    state().removeLayer(1);
    expect(state().error).toContain('仍有按键');
    expect(state().draft.layers).toHaveLength(2);
    state().dismiss();
    await state().addLayer();
    expect(state().baseline.layers).toHaveLength(3);
    const id = state().layerId;
    state().moveLayer(id, -1);
    await state().apply();
    expect(state().baseline.layers[1].id).toBe(id);
    const backup = structuredClone(state().baseline);
    state().removeLayer(id);
    expect(state().layerId).toBe(0);
    expect(state().requiresReview).toBe(true);
    await state().apply();
    expect(state().baseline.layers).toHaveLength(2);
    state().loadProfile(backup);
    await state().apply();
    expect(state().baseline.layers).toHaveLength(3);
  });
});
