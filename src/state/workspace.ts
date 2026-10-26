import { create } from 'zustand';
import { previewSnapshot, DemoDriver } from '../domain/demo';
import {
  clone,
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

type Page = 'devices' | 'keymap' | 'macros' | 'profiles' | 'test' | 'diagnostics';
interface DeviceSession {
  model: ModelId;
  baseline: DeviceSnapshot;
  draft: DeviceSnapshot;
  connection: 'offline' | 'device' | 'demo';
  layerId: number;
  selectedIndex: number | null;
  history: DeviceSnapshot[];
  future: DeviceSnapshot[];
}
interface Workspace {
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
  logs: Diagnostic[];
  error: string | null;
  notice: string | null;
  progress: string;
  setPage(page: Page): void;
  openDevice(model: ModelId): void;
  connect(model?: ModelId, demo?: boolean): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
  apply(): Promise<void>;
  edit(index: number, binding: Binding): void;
  editMacro(index: number, bytes: number[]): void;
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
const initial = previewSnapshot('neo75cu');
const log = (message: string, level: Diagnostic['level'] = 'info') =>
  useWorkspace.setState((s) => ({
    logs: [...s.logs.slice(-199), { time: new Date().toISOString(), level, message }],
  }));
export const isDirty = (s: Pick<Workspace, 'baseline' | 'draft'>) =>
  !sameConfiguration(s.baseline, s.draft);
export const hasUnsavedDrafts = (s: Workspace) =>
  isDirty(s) ||
  Object.values(s.sessions).some((session) => session.model !== s.model && isDirty(session));
function rememberCurrent() {
  const { model, baseline, draft, connection, layerId, selectedIndex, history, future, sessions } =
    useWorkspace.getState();
  if (!sessions[model] && connection === 'offline') return;
  useWorkspace.setState({
    sessions: {
      ...sessions,
      [model]: { model, baseline, draft, connection, layerId, selectedIndex, history, future },
    },
  });
}
export const useWorkspace = create<Workspace>((set, get) => ({
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
  logs: [],
  error: null,
  notice: null,
  progress: '',
  setPage: (page) => {
    if (get().operation !== 'idle') return;
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
    if (get().operation !== 'idle') return;
    rememberCurrent();
    const session = get().sessions[model];
    if (!session) return;
    set({ ...session, workspaceOpen: true, page: 'keymap', error: null, notice: null });
  },
  async connect(model = get().model, demo = false) {
    if (get().operation !== 'idle') return false;
    rememberCurrent();
    const previous = get().sessions[model];
    if (previous?.connection === (demo ? 'demo' : 'device')) {
      get().openDevice(model);
      return true;
    }
    if (demo && previous?.connection === 'device') {
      get().report('这台键盘已真实连接。请先断开它，再打开同型号的演示。');
      return false;
    }
    set({ operation: 'connecting', error: null, notice: null, progress: '等待选择设备' });
    let candidate: Driver | undefined;
    try {
      // requestDevice/requestPort must run directly from the user's click, before any unrelated await.
      const opening = demo
        ? Promise.resolve(new DemoDriver(model))
        : model === 'neo75cu'
          ? ViaDriver.connect()
          : ZmkDriver.connect();
      candidate = await opening;
      set({ progress: '读取原厂配置' });
      const snapshot = await candidate.read();
      let session: DeviceSession = {
        model,
        baseline: snapshot,
        draft: clone(snapshot),
        connection: demo ? 'demo' : 'device',
        layerId: snapshot.layers[0].id,
        selectedIndex: null,
        history: [],
        future: [],
      };
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
            };
        } catch {
          /* Different firmware or physical layout: retain the archived draft, use the new snapshot. */
        }
      }
      await drivers.get(model)?.close();
      drivers.set(model, candidate);
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
        ...session,
        sessions: { ...s.sessions, [model]: session },
        workspaceOpen: demo,
        page: demo ? 'keymap' : 'devices',
      }));
      log(
        `${snapshot.name} ${demo ? '演示模式' : 'USB 已连接'} · ${snapshot.layers.length} 层 · ${snapshot.keys.length} 键`,
        'success',
      );
      return true;
    } catch (e) {
      await candidate?.close();
      if (e instanceof DOMException && ['NotFoundError', 'AbortError'].includes(e.name))
        set({ notice: '已取消连接，可以随时重试。' });
      else get().report(e);
      return false;
    } finally {
      set({ operation: 'idle', progress: '' });
    }
  },
  async disconnect() {
    if (get().operation !== 'idle') return;
    const model = get().model;
    set({ operation: 'reading', progress: '关闭设备连接' });
    try {
      await drivers.get(model)?.close();
      drivers.delete(model);
      set({ connection: 'offline' });
      rememberCurrent();
      log('连接已关闭，当前草稿保留。');
    } catch (e) {
      get().report(e);
    } finally {
      set({ operation: 'idle', progress: '' });
    }
  },
  async refresh() {
    const driver = drivers.get(get().model);
    if (!driver || get().operation !== 'idle' || get().connection === 'offline') return;
    set({ operation: 'reading', error: null, progress: '读取设备配置' });
    try {
      if (isDirty(get()))
        await saveProfile(`${get().draft.name} · 读取前草稿`, get().draft, 'draft');
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
        notice: '已重新读取设备。原有未保存草稿会保留在方案库。',
      });
      log('设备配置已重新读取。', 'success');
    } catch (e) {
      get().report(e);
    } finally {
      set({ operation: 'idle', progress: '' });
    }
  },
  async apply() {
    const driver = drivers.get(get().model);
    if (!driver || get().operation !== 'idle' || get().connection === 'offline') return;
    set({ operation: 'saving', error: null, notice: null });
    try {
      const snapshot = await applyConfiguration(
        driver,
        get().baseline,
        get().draft,
        (s) => saveProfile(`${s.name} · 写入前备份`, s, 'backup'),
        (progress) => set({ progress }),
      );
      const demo = get().connection === 'demo';
      set({
        baseline: snapshot,
        draft: clone(snapshot),
        history: [],
        future: [],
        notice: demo ? '演示配置已更新，未操作真实键盘。' : '已保存到键盘，并通过读回校验。',
      });
      log(demo ? '演示写入已通过模拟校验。' : '设备写入已通过读回校验。', 'success');
    } catch (e) {
      get().report(
        `${errorMessage(e)} 如已开始写入，设备可能已部分改变；请到方案库查看写入前备份，重新读取后再恢复。`,
      );
    } finally {
      set({ operation: 'idle', progress: '' });
    }
  },
  edit(index, binding) {
    if (get().operation !== 'idle') return;
    set((s) => {
      const draft = clone(s.draft),
        layer = draft.layers.find((l) => l.id === s.layerId);
      if (!layer || index < 0 || index >= layer.bindings.length) return s;
      layer.bindings[index] = clone(binding);
      return { draft, history: [...s.history.slice(-99), clone(s.draft)], future: [] };
    });
  },
  editMacro(index, bytes) {
    if (get().operation !== 'idle' || index < 0 || index >= get().draft.macros.length) return;
    set((s) => {
      const draft = clone(s.draft);
      draft.macros[index] = [...bytes];
      return { draft, history: [...s.history.slice(-99), clone(s.draft)], future: [] };
    });
  },
  undo() {
    if (get().operation !== 'idle' || !get().history.length) return;
    set((s) => ({
      draft: s.history.at(-1)!,
      history: s.history.slice(0, -1),
      future: [clone(s.draft), ...s.future],
    }));
  },
  redo() {
    if (get().operation !== 'idle' || !get().future.length) return;
    set((s) => ({
      draft: s.future[0],
      future: s.future.slice(1),
      history: [...s.history, clone(s.draft)],
    }));
  },
  resetDraft() {
    if (get().operation !== 'idle') return;
    set((s) => ({
      draft: clone(s.baseline),
      history: [...s.history.slice(-99), clone(s.draft)],
      future: [],
    }));
  },
  loadProfile(snapshot) {
    if (get().operation !== 'idle') return;
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
        page: 'keymap',
        notice: '正在离线查看方案。连接对应键盘后可从方案库载入并保存。',
      });
      return;
    }
    const current = get().draft;
    const imported = clone(snapshot);
    imported.identity = current.identity;
    if (JSON.stringify(imported.keys) !== JSON.stringify(current.keys))
      throw new Error('方案的物理配列与当前设备不同，请使用匹配的备份。');
    sameConfiguration(current, imported); // validates model, protocol, layers and behavior identity.
    imported.locked = current.locked;
    imported.firmwareUnsaved = current.firmwareUnsaved;
    set((s) => ({
      draft: imported,
      history: [...s.history.slice(-99), clone(s.draft)],
      future: [],
      notice: '方案已载入草稿。检查差异后点击“保存到键盘”才会写入。',
    }));
  },
}));
