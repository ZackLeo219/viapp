import { create } from 'zustand';
import { previewSnapshot, DemoDriver } from '../domain/demo';
import {
  clone,
  layerName,
  assertCompatible,
  equalBinding,
  errorMessage,
  type Binding,
  type DeviceSnapshot,
  type Diagnostic,
  type Driver,
  type ModelId,
} from '../domain/types';
import { sameConfiguration, applyConfiguration } from '../domain/apply';
import { saveProfile } from './database';
import { ViaDriver } from '../protocols/via';
import { ZmkDriver } from '../protocols/zmk';
import { requestDeviceAccess, type DeviceAccess } from '../protocols/discovery';
import { decodeMacro, type MacroStep } from '../domain/macros';
import { snapshotLayout } from '../domain/via-definition';
import { DefinitionRequired, importDefinition as storeDefinition } from '../devices/via-registry';
import { normalizeEmptyBindings, referencedLayers } from '../domain/behaviors';

type Page = 'devices' | 'keymap' | 'macros' | 'profiles' | 'test' | 'settings';
interface DeviceSession {
  model: ModelId;
  baseline: DeviceSnapshot;
  draft: DeviceSnapshot;
  connection: 'offline' | 'device' | 'demo';
  layerId: number;
  selectedIndex: number | null;
  history: DeviceSnapshot[];
  future: DeviceSnapshot[];
  macroDrafts: Record<number, MacroStep[]>;
  autoSaveRequested: boolean;
  requiresReview: boolean;
  autoSaveBlocked: boolean;
}
interface Workspace {
  pendingDevices: Partial<
    Record<
      ModelId,
      {
        model: ModelId;
        name: string;
        message: string;
        access: Extract<DeviceAccess, { transport: 'hid' }>;
      }
    >
  >;
  importDefinition(model: ModelId, contents: string): Promise<boolean>;
  retryDefinition(model: ModelId): Promise<boolean>;
  dismissPending(model: ModelId): void;
  autoSave: boolean;
  autoSaving: boolean;
  autoSaveRequested: boolean;
  requiresReview: boolean;
  autoSaveBlocked: boolean;
  autoConnectBlocked: ModelId[];
  workspaceOpen: boolean;
  sessions: Partial<Record<ModelId, DeviceSession>>;
  model: ModelId;
  page: Page;
  baseline: DeviceSnapshot;
  draft: DeviceSnapshot;
  connection: 'offline' | 'device' | 'demo';
  operation: 'idle' | 'connecting' | 'reading' | 'saving';
  layerId: number;
  selectedIndex: number | null;
  history: DeviceSnapshot[];
  future: DeviceSnapshot[];
  macroDrafts: Record<number, MacroStep[]>;
  logs: Diagnostic[];
  error: string | null;
  notice: string | null;
  progress: string;
  setPage(page: Page): void;
  openDevice(model: ModelId): void;
  connect(
    model?: ModelId,
    demo?: boolean,
    options?: { access?: DeviceAccess; automatic?: boolean },
  ): Promise<boolean>;
  authorize(transport: 'hid' | 'serial'): Promise<boolean>;
  disconnect(model?: ModelId): Promise<void>;
  refresh(): Promise<void>;
  apply(options?: { automatic?: boolean }): Promise<void>;
  setAutoSave(enabled: boolean): void;
  edit(index: number, binding: Binding): void;
  editMacro(index: number, bytes: number[]): void;
  setLayout(options: number): void;
  moveLayer(id: number, direction: -1 | 1): void;
  removeLayer(id: number): void;
  copyLayer(source: number, target: number): void;
  addLayer(): Promise<void>;
  resolveDeviceChanges(save: boolean): Promise<void>;
  stageMacro(index: number, steps: MacroStep[]): void;
  discardMacro(index: number): void;
  selectKey(index: number | null): void;
  selectLayer(id: number): void;
  undo(): void;
  redo(): void;
  resetDraft(): void;
  loadProfile(snapshot: DeviceSnapshot): void;
  dismiss(): void;
  report(error: unknown): void;
  notify(message: string): void;
}
const drivers = new Map<ModelId, Driver>();
const connectedHandles = new Map<ModelId, object>();
const initial = previewSnapshot('neo75cu');
const log = (message: string, level: Diagnostic['level'] = 'info') =>
  useWorkspace.setState((s) => ({
    logs: [...s.logs.slice(-199), { time: new Date().toISOString(), level, message }],
  }));
export const isDirty = (s: Pick<Workspace, 'baseline' | 'draft'>) =>
  !sameConfiguration(s.baseline, s.draft);
export const hasUnsavedDrafts = (s: Workspace) =>
  isDirty(s) ||
  Object.keys(s.macroDrafts).length > 0 ||
  Object.values(s.sessions).some(
    (session) =>
      !!session &&
      session.model !== s.model &&
      (isDirty(session) || Object.keys(session.macroDrafts).length > 0),
  );
export const isAutoSavePending = (s: Workspace) =>
  s.autoSave &&
  s.autoSaveRequested &&
  !s.requiresReview &&
  !s.autoSaveBlocked &&
  s.connection !== 'offline' &&
  !s.draft.locked &&
  isDirty(s);
export const isWorkspaceBusy = (s: Workspace) => s.operation !== 'idle' || isAutoSavePending(s);
export const isEditingBlocked = (s: Workspace) => s.operation !== 'idle' && !s.autoSaving;
export async function readDeviceMatrix(): Promise<number[] | null> {
  const s = useWorkspace.getState();
  if (s.connection !== 'device' || s.page !== 'test' || s.operation !== 'idle') return null;
  return drivers.get(s.model)?.readMatrix?.() ?? null;
}
function editSettings(change: (draft: DeviceSnapshot) => void, review = false) {
  const s = useWorkspace.getState();
  if (s.operation !== 'idle') return;
  try {
    const draft = clone(s.draft);
    change(draft);
    if (sameConfiguration(s.draft, draft)) return;
    useWorkspace.setState({
      draft,
      history: [...s.history.slice(-99), clone(s.draft)],
      future: [],
      layerId: draft.layers.some((l) => l.id === s.layerId) ? s.layerId : draft.layers[0].id,
      selectedIndex: null,
      autoSaveRequested: !review,
      requiresReview: s.requiresReview || review,
    });
  } catch (error) {
    s.report(error);
  }
}
function autoSavePreference() {
  try {
    return localStorage.getItem('viapp:auto-save') !== 'off';
  } catch {
    return true;
  }
}
function rememberCurrent() {
  const {
    model,
    baseline,
    draft,
    connection,
    layerId,
    selectedIndex,
    history,
    future,
    macroDrafts,
    sessions,
    autoSaveRequested,
    requiresReview,
    autoSaveBlocked,
  } = useWorkspace.getState();
  if (!sessions[model] && connection === 'offline') return;
  useWorkspace.setState({
    sessions: {
      ...sessions,
      [model]: {
        model,
        baseline,
        draft,
        connection,
        layerId,
        selectedIndex,
        history,
        future,
        macroDrafts,
        autoSaveRequested,
        requiresReview,
        autoSaveBlocked,
      },
    },
  });
}
export const useWorkspace = create<Workspace>((set, get) => ({
  pendingDevices: {},
  async importDefinition(model, contents) {
    const pending = get().pendingDevices[model];
    if (!pending || isWorkspaceBusy(get())) return false;
    try {
      if (contents.length > 2_000_000) throw new Error('键盘定义不能超过 2 MB。');
      let raw: unknown;
      try {
        raw = JSON.parse(contents);
      } catch {
        throw new Error('无法解析 JSON 键盘定义。');
      }
      storeDefinition(pending.access.device, raw);
      return await get().connect(model, false, { access: pending.access });
    } catch (error) {
      get().report(error);
      return false;
    }
  },
  async retryDefinition(model) {
    const pending = get().pendingDevices[model];
    return pending ? get().connect(model, false, { access: pending.access }) : false;
  },
  dismissPending(model) {
    set((s) => {
      const pendingDevices = { ...s.pendingDevices };
      delete pendingDevices[model];
      return { pendingDevices, autoConnectBlocked: [...new Set([...s.autoConnectBlocked, model])] };
    });
  },
  autoSave: autoSavePreference(),
  autoSaving: false,
  autoSaveRequested: false,
  requiresReview: false,
  autoSaveBlocked: false,
  autoConnectBlocked: [],
  workspaceOpen: false,
  sessions: {},
  model: 'neo75cu',
  page: 'devices',
  baseline: initial,
  draft: clone(initial),
  connection: 'offline',
  operation: 'idle',
  layerId: 0,
  selectedIndex: null,
  history: [],
  future: [],
  macroDrafts: {},
  logs: [],
  error: null,
  notice: null,
  progress: '',
  setPage: (page) => {
    if (isWorkspaceBusy(get())) return;
    if (!get().workspaceOpen && page !== 'devices') return;
    if (page === 'devices') {
      rememberCurrent();
      set({ workspaceOpen: false });
    }
    set({ page });
  },
  selectKey: (selectedIndex) => set({ selectedIndex }),
  selectLayer: (layerId) => set({ layerId }),
  dismiss: () => set({ error: null, notice: null }),
  report: (error) => {
    const message = errorMessage(error);
    set({ error: message });
    log(message, 'error');
  },
  notify: (notice) => set({ notice, error: null }),
  openDevice(model) {
    if (isWorkspaceBusy(get())) return;
    rememberCurrent();
    const session = get().sessions[model];
    if (!session) return;
    set({ ...session, workspaceOpen: true, page: 'keymap', error: null, notice: null });
  },
  async authorize(transport) {
    if (isWorkspaceBusy(get())) return false;
    set({ operation: 'connecting', error: null, notice: null, progress: '等待授权' });
    let access: DeviceAccess;
    try {
      access = await requestDeviceAccess(transport);
    } catch (e) {
      if (!(e instanceof DOMException && ['NotFoundError', 'AbortError'].includes(e.name)))
        get().report(e);
      return false;
    } finally {
      set({ operation: 'idle', progress: '' });
    }
    return get().connect(access.model, false, { access });
  },
  async connect(model = get().model, demo = false, options = {}) {
    if (isWorkspaceBusy(get())) return false;
    if (options.access && options.access.model !== model) throw new Error('设备类型不匹配。');
    rememberCurrent();
    const previous = get().sessions[model];
    if (previous?.connection === (demo ? 'demo' : 'device')) {
      const access = options.access;
      const handle = access?.transport === 'hid' ? access.device : access?.port;
      if (handle && connectedHandles.has(model) && connectedHandles.get(model) !== handle) {
        get().report('已连接一台同型号设备，请先断开当前设备。');
        return false;
      }
      if (!options.automatic) get().openDevice(model);
      return true;
    }
    if (demo && previous?.connection === 'device') {
      get().report('这台键盘已真实连接。请先断开它，再打开同型号的演示。');
      return false;
    }
    set({
      operation: 'connecting',
      error: null,
      notice: null,
      progress: options.access ? '读取设备' : '等待选择设备',
    });
    let candidate: Driver | undefined;
    try {
      let access = options.access;
      const stale = previous?.connection === 'offline' ? drivers.get(model) : undefined;
      if (stale) {
        // Obtain permission in the click before awaiting teardown. An offline
        // driver's close may still be releasing its exclusive serial handle.
        if (!demo && !access)
          access = await requestDeviceAccess(model === 'tofu-pad' ? 'serial' : 'hid');
        await stale.close();
        drivers.delete(model);
      }
      // requestDevice/requestPort must run directly from the user's click, before any unrelated await.
      const opening = demo
        ? Promise.resolve(new DemoDriver(model))
        : model !== 'tofu-pad'
          ? ViaDriver.connect(access?.transport === 'hid' ? access.device : undefined)
          : ZmkDriver.connect(access?.transport === 'serial' ? access.port : undefined);
      candidate = await opening;
      set({ progress: '读取原厂配置' });
      const snapshot = await candidate.read();
      if (snapshot.model !== model) throw new Error('连接的键盘型号已改变，请重新添加设备。');
      let session: DeviceSession = {
        model,
        baseline: snapshot,
        draft: clone(snapshot),
        connection: demo ? 'demo' : 'device',
        layerId: snapshot.layers[0].id,
        selectedIndex: null,
        history: [],
        future: [],
        macroDrafts: {},
        autoSaveRequested: false,
        requiresReview: false,
        autoSaveBlocked: false,
      };
      if (previous) {
        try {
          assertCompatible(previous.draft, snapshot);
          session.macroDrafts = previous.macroDrafts;
        } catch {
          // Staged macro input belongs to this device and firmware only.
        }
      }
      if (previous && isDirty(previous)) {
        await saveProfile(`${previous.draft.name} · 重连前草稿`, previous.draft, 'draft');
        try {
          if (sameConfiguration(previous.baseline, snapshot))
            session = {
              ...previous,
              baseline: snapshot,
              draft: {
                ...previous.draft,
                locked: snapshot.locked,
                firmwareUnsaved: snapshot.firmwareUnsaved,
              },
              connection: session.connection,
              autoSaveRequested: false,
              requiresReview: true,
              autoSaveBlocked: false,
            };
        } catch {
          /* Different firmware or physical layout: retain the archived draft, use the new snapshot. */
        }
      }
      await drivers.get(model)?.close();
      drivers.set(model, candidate);
      const handle = access?.transport === 'hid' ? access.device : access?.port;
      if (handle) connectedHandles.set(model, handle);
      else connectedHandles.delete(model);
      const active = candidate;
      active.onDisconnect = (reason) => {
        if (drivers.get(model) !== active) return;
        set((s) => ({
          ...(s.model === model ? { connection: 'offline' as const } : {}),
          sessions: { ...s.sessions, [model]: { ...s.sessions[model]!, connection: 'offline' } },
          error: `${snapshot.name}：${reason}`,
        }));
        log(`${snapshot.name}：${reason}`, 'error');
      };
      active.onLockChange = (locked) => {
        if (drivers.get(model) !== active) return;
        set((s) => {
          const stored = s.sessions[model]!;
          return {
            ...(s.model === model
              ? { baseline: { ...s.baseline, locked }, draft: { ...s.draft, locked } }
              : {}),
            sessions: {
              ...s.sessions,
              [model]: {
                ...stored,
                baseline: { ...stored.baseline, locked },
                draft: { ...stored.draft, locked },
              },
            },
          };
        });
      };
      set((s) => ({
        ...(!options.automatic || s.model === model ? session : {}),
        pendingDevices: Object.fromEntries(
          Object.entries(s.pendingDevices).filter(([key]) => key !== model),
        ),
        sessions: { ...s.sessions, [model]: session },
        autoConnectBlocked: s.autoConnectBlocked.filter((m) => m !== model),
        ...(!options.automatic
          ? { workspaceOpen: demo, page: demo ? ('keymap' as const) : ('devices' as const) }
          : {}),
      }));
      log(
        `${snapshot.name} ${demo ? '演示模式' : 'USB 已连接'} · ${snapshot.layers.length} 层 · ${snapshot.keys.length} 键`,
        'success',
      );
      return true;
    } catch (e) {
      await candidate?.close();
      if (e instanceof DefinitionRequired && options.access?.transport === 'hid') {
        const access = options.access;
        set((s) => ({
          pendingDevices: {
            ...s.pendingDevices,
            [model]: {
              model,
              name: access.device.productName || 'VIA 键盘',
              message: e.message,
              access,
            },
          },
        }));
      } else if (e instanceof DOMException && ['NotFoundError', 'AbortError'].includes(e.name))
        set({ notice: '已取消连接，可以随时重试。' });
      else get().report(e);
      return false;
    } finally {
      set({ operation: 'idle', progress: '' });
    }
  },
  async disconnect(model = get().model) {
    if (isWorkspaceBusy(get())) return;
    rememberCurrent();
    set({ operation: 'reading', progress: '关闭设备连接' });
    try {
      await drivers.get(model)?.close();
      drivers.delete(model);
      connectedHandles.delete(model);
      set((s) => ({
        ...(s.model === model ? { connection: 'offline' as const } : {}),
        sessions: s.sessions[model]
          ? { ...s.sessions, [model]: { ...s.sessions[model], connection: 'offline' } }
          : s.sessions,
        autoConnectBlocked: [...new Set([...s.autoConnectBlocked, model])],
      }));
      log('连接已关闭，当前草稿保留。');
    } catch (e) {
      get().report(e);
    } finally {
      set({ operation: 'idle', progress: '' });
    }
  },
  async refresh() {
    const driver = drivers.get(get().model);
    if (!driver || isWorkspaceBusy(get()) || get().connection === 'offline') return;
    set({ operation: 'reading', error: null, progress: '读取设备配置' });
    try {
      const hadDraft = isDirty(get());
      if (hadDraft) await saveProfile(`${get().draft.name} · 读取前草稿`, get().draft, 'draft');
      const snapshot = await driver.read();
      set({
        baseline: snapshot,
        draft: clone(snapshot),
        layerId: snapshot.layers.some((l) => l.id === get().layerId)
          ? get().layerId
          : snapshot.layers[0].id,
        selectedIndex: null,
        history: [],
        future: [],
        autoSaveRequested: false,
        requiresReview: false,
        autoSaveBlocked: false,
        notice: hadDraft ? '已重新读取，原草稿已备份。' : '已重新读取。',
      });
      log('设备配置已重新读取。', 'success');
    } catch (e) {
      get().report(e);
    } finally {
      set({ operation: 'idle', progress: '' });
    }
  },
  setAutoSave(autoSave) {
    if (get().operation !== 'idle') return;
    try {
      localStorage.setItem('viapp:auto-save', autoSave ? 'on' : 'off');
    } catch {
      /* Optional preference. */
    }
    set({ autoSave, autoSaveRequested: autoSave && isDirty(get()) });
  },
  async apply({ automatic = false } = {}) {
    const driver = drivers.get(get().model);
    if (!driver || get().operation !== 'idle' || get().connection === 'offline') return;
    if (automatic && !isAutoSavePending(get())) return;
    const { baseline, draft: desired } = get();
    set({
      operation: 'saving',
      autoSaving: automatic,
      autoSaveRequested: false,
      error: null,
      notice: null,
    });
    try {
      const snapshot = await applyConfiguration(
        driver,
        baseline,
        desired,
        (s) => saveProfile(`${s.name} · 写入前备份`, s, 'backup'),
        (progress) => set({ progress }),
      );
      const demo = get().connection === 'demo';
      set((s) => ({
        baseline: snapshot,
        // Edits made during the write belong to the next transaction.
        draft:
          automatic && s.draft !== desired
            ? { ...s.draft, locked: snapshot.locked, firmwareUnsaved: snapshot.firmwareUnsaved }
            : clone(snapshot),
        history: automatic ? s.history : [],
        future: automatic ? s.future : [],
        requiresReview: false,
        autoSaveBlocked: false,
        notice: automatic ? null : demo ? '演示配置已更新，未操作真实键盘。' : '已保存到键盘。',
      }));
      log(demo ? '演示写入已通过模拟校验。' : '设备写入已通过读回校验。', 'success');
    } catch (e) {
      set({ autoSaveBlocked: true, autoSaveRequested: false });
      get().report(
        `${errorMessage(e)} 修改已保留，请重新读取设备后检查；写入前备份可在配置管理中恢复。`,
      );
    } finally {
      rememberCurrent();
      set({ operation: 'idle', autoSaving: false, progress: '' });
    }
  },
  edit(index, binding) {
    if (isEditingBlocked(get())) return;
    set((s) => {
      const draft = clone(s.draft),
        layer = draft.layers.find((l) => l.id === s.layerId);
      if (!layer || index < 0 || index >= layer.bindings.length) return s;
      if (equalBinding(layer.bindings[index], binding)) return s;
      layer.bindings[index] = clone(binding);
      return {
        draft,
        history: [...s.history.slice(-99), clone(s.draft)],
        future: [],
        autoSaveRequested: true,
      };
    });
  },
  setLayout(options) {
    editSettings((draft) => {
      if (
        draft.protocol !== 'via' ||
        !Number.isInteger(options) ||
        options < 0 ||
        options > 0xffffffff
      )
        throw new Error('配列选项无效。');
      draft.layoutOptions = options;
      draft.keys = snapshotLayout(draft, options);
    });
  },
  moveLayer(id, direction) {
    editSettings((draft) => {
      if (!draft.deviceInfo?.layerCapacity) throw new Error('当前固件不支持调整图层顺序。');
      const index = draft.layers.findIndex((l) => l.id === id),
        target = index + direction;
      if (index <= 0 || target <= 0 || target >= draft.layers.length) return;
      draft.layers.splice(target, 0, draft.layers.splice(index, 1)[0]);
    });
  },
  removeLayer(id) {
    editSettings((draft) => {
      if (!draft.deviceInfo?.layerCapacity || id === draft.layers[0].id)
        throw new Error('基础层不能删除。');
      if (
        draft.layers
          .filter((l) => l.id !== id)
          .some((l) => l.bindings.some((b) => referencedLayers(draft, b).includes(id)))
      )
        throw new Error('其他图层中仍有按键使用此层，请先修改这些按键。');
      draft.layers = draft.layers.filter((l) => l.id !== id);
    }, true);
  },
  copyLayer(source, target) {
    editSettings((draft) => {
      const from = draft.layers.find((l) => l.id === source),
        to = draft.layers.find((l) => l.id === target);
      if (from && to && source !== target) to.bindings = clone(from.bindings);
    }, true);
  },
  async addLayer() {
    const s = get(),
      driver = drivers.get(s.model);
    if (isWorkspaceBusy(s) || s.connection === 'offline' || !driver?.addLayer) return;
    if (isDirty(s) || Object.keys(s.macroDrafts).length) {
      s.report('请先保存或撤销当前修改。');
      return;
    }
    set({ operation: 'saving', progress: '新增图层', error: null });
    let committing = false;
    let stagedByUs = false;
    try {
      const current = await driver.read();
      if (current.locked || current.firmwareUnsaved || !sameConfiguration(s.baseline, current))
        throw new Error('设备配置已变化，请重新读取。');
      await saveProfile(`${current.name} · 新增图层前`, current, 'backup');
      stagedByUs = true;
      await driver.addLayer();
      const staged = await driver.read();
      const retained = {
        ...staged,
        layers: staged.layers.filter((l) => current.layers.some((c) => c.id === l.id)),
      };
      if (
        staged.layers.length !== current.layers.length + 1 ||
        !sameConfiguration(current, retained)
      )
        throw new Error('新增图层校验失败。');
      committing = true;
      await driver.commit();
      const snapshot = await driver.read();
      if (!sameConfiguration(staged, snapshot) || snapshot.firmwareUnsaved)
        throw new Error('新增图层保存失败。');
      const added = snapshot.layers.find((l) => !current.layers.some((c) => c.id === l.id))!;
      set({
        baseline: snapshot,
        draft: clone(snapshot),
        history: [],
        future: [],
        selectedIndex: null,
        layerId: added.id,
        notice: '已新增图层。',
        autoSaveBlocked: false,
      });
    } catch (error) {
      if (stagedByUs && !committing) await driver.discardChanges?.().catch(() => undefined);
      get().report(error);
    } finally {
      set({ operation: 'idle', progress: '' });
      rememberCurrent();
    }
  },
  async resolveDeviceChanges(save) {
    const s = get(),
      driver = drivers.get(s.model);
    if (!driver || s.draft.protocol !== 'zmk' || isWorkspaceBusy(s) || s.connection === 'offline')
      return;
    set({ operation: 'saving', progress: save ? '保存设备配置' : '撤销设备修改', error: null });
    try {
      const current = await driver.read();
      if (current.locked) throw new Error('请先解锁键盘。');
      await saveProfile(`${current.name} · 设备配置备份`, current, 'backup');
      if (isDirty(s)) await saveProfile(`${s.draft.name} · 草稿备份`, s.draft, 'draft');
      if (save) await driver.commit();
      else {
        if (!driver.discardChanges) throw new Error('当前固件不支持撤销。');
        await driver.discardChanges();
      }
      const snapshot = await driver.read();
      if (snapshot.firmwareUnsaved || (save && !sameConfiguration(current, snapshot)))
        throw new Error('设备配置校验失败。');
      set({
        baseline: snapshot,
        draft: clone(snapshot),
        layerId: snapshot.layers[0].id,
        selectedIndex: null,
        history: [],
        future: [],
        autoSaveRequested: false,
        requiresReview: false,
        autoSaveBlocked: false,
        notice: save ? '已保存到键盘。' : '已撤销设备修改。',
      });
    } catch (error) {
      get().report(error);
    } finally {
      set({ operation: 'idle', progress: '' });
      rememberCurrent();
    }
  },
  editMacro(index, bytes) {
    if (isEditingBlocked(get()) || index < 0 || index >= get().draft.macros.length) return;
    set((s) => {
      const macroDrafts = { ...s.macroDrafts };
      delete macroDrafts[index];
      if (JSON.stringify(s.draft.macros[index]) === JSON.stringify(bytes)) return { macroDrafts };
      const draft = clone(s.draft);
      draft.macros[index] = [...bytes];
      return {
        draft,
        history: [...s.history.slice(-99), clone(s.draft)],
        future: [],
        macroDrafts,
        autoSaveRequested: true,
      };
    });
  },
  stageMacro(index, steps) {
    if (isEditingBlocked(get()) || !get().draft.macros[index]) return;
    set((s) => {
      const macroDrafts = { ...s.macroDrafts };
      const original = decodeMacro(s.draft.macros[index], s.draft.protocolVersion);
      if (JSON.stringify(original) === JSON.stringify(steps)) delete macroDrafts[index];
      else macroDrafts[index] = clone(steps);
      return { macroDrafts };
    });
  },
  discardMacro(index) {
    set((s) => {
      const macroDrafts = { ...s.macroDrafts };
      delete macroDrafts[index];
      return { macroDrafts };
    });
  },
  undo() {
    if (isEditingBlocked(get()) || !get().history.length) return;
    set((s) => ({
      layerId: s.history.at(-1)!.layers.some((l) => l.id === s.layerId)
        ? s.layerId
        : s.history.at(-1)!.layers[0].id,
      selectedIndex: null,
      draft: {
        ...s.history.at(-1)!,
        locked: s.baseline.locked,
        firmwareUnsaved: s.baseline.firmwareUnsaved,
      },
      history: s.history.slice(0, -1),
      future: [clone(s.draft), ...s.future],
      autoSaveRequested: true,
    }));
  },
  redo() {
    if (isEditingBlocked(get()) || !get().future.length) return;
    set((s) => ({
      layerId: s.future[0].layers.some((l) => l.id === s.layerId)
        ? s.layerId
        : s.future[0].layers[0].id,
      selectedIndex: null,
      draft: {
        ...s.future[0],
        locked: s.baseline.locked,
        firmwareUnsaved: s.baseline.firmwareUnsaved,
      },
      future: s.future.slice(1),
      history: [...s.history, clone(s.draft)],
      autoSaveRequested: true,
    }));
  },
  resetDraft() {
    if (get().operation !== 'idle') return;
    set((s) => ({
      draft: clone(s.baseline),
      layerId: s.baseline.layers.some((l) => l.id === s.layerId)
        ? s.layerId
        : s.baseline.layers[0].id,
      selectedIndex: null,
      history: s.requiresReview ? [] : [...s.history.slice(-99), clone(s.draft)],
      future: [],
      autoSaveRequested: false,
      requiresReview: false,
    }));
  },
  loadProfile(snapshot) {
    if (isWorkspaceBusy(get())) return;
    snapshot = normalizeEmptyBindings(snapshot);
    rememberCurrent();
    const target = get().sessions[snapshot.model];
    if (target && target.connection !== 'offline') get().openDevice(snapshot.model);
    else {
      const imported = clone(snapshot);
      set({
        model: imported.model,
        connection: 'offline',
        workspaceOpen: true,
        baseline: clone(imported),
        draft: imported,
        layerId: imported.layers[0].id,
        selectedIndex: null,
        history: [],
        future: [],
        macroDrafts: target?.macroDrafts ?? {},
        page: 'keymap',
        autoSaveRequested: false,
        requiresReview: true,
        autoSaveBlocked: false,
        notice: '离线预览。连接键盘后可载入此配置。',
      });
      return;
    }
    const current = get().draft;
    const imported = clone(snapshot);
    imported.identity = current.identity;
    assertCompatible(current, imported, true);
    imported.deviceInfo = clone(current.deviceInfo);
    imported.behaviors = clone(current.behaviors);
    for (const layer of imported.layers) {
      const present = current.layers.find((l) => l.id === layer.id);
      if (layer.storedName === undefined && present?.name === layer.name)
        layer.storedName = present.storedName;
      if (layer.storedName === '') layer.name = layerName(layer);
    }
    if (
      imported.protocol !== 'via' &&
      JSON.stringify(imported.keys) !== JSON.stringify(current.keys)
    )
      throw new Error('配置的物理配列与当前设备不同，请使用匹配的备份。');
    sameConfiguration(current, imported); // validates model, protocol, layers and behavior identity.
    imported.locked = current.locked;
    imported.firmwareUnsaved = current.firmwareUnsaved;
    const requiresReview = !sameConfiguration(get().baseline, imported);
    set((s) => ({
      draft: imported,
      layerId: imported.layers.some((l) => l.id === s.layerId) ? s.layerId : imported.layers[0].id,
      selectedIndex: null,
      history: requiresReview ? [...s.history.slice(-99), clone(s.draft)] : [],
      future: [],
      autoSaveRequested: false,
      requiresReview,
      notice: requiresReview ? '配置已载入，请确认后保存到键盘。' : '配置与键盘一致。',
    }));
  },
}));
