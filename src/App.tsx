import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronLeft,
  CircleHelp,
  Command,
  FileJson,
  FolderCog,
  History,
  Info,
  Keyboard as KeyboardIcon,
  Layers3,
  SlidersHorizontal,
  LayoutGrid,
  LoaderCircle,
  MonitorCheck,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Unplug,
  WandSparkles,
  X,
} from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Keyboard } from './components/Keyboard';
import { TesterPage } from './components/TesterPage';
import { DeviceSettings } from './components/DeviceSettings';
import { IdleKeyboard } from './components/IdleKeyboard';
import { DeviceConnect } from './components/DeviceConnect';
import { KeyCapture } from './components/KeyCapture';
import { ShortcutEditor, DualRoleEditor } from './components/AdvancedBinding';
import { advancedKind } from './domain/behaviors';
import { layersChanged } from './domain/apply';
import './components/DeviceHub.css';
import { version } from '../package.json';
import { Modal } from './components/Modal';
import {
  useWorkspace,
  isDirty,
  hasUnsavedDrafts,
  isWorkspaceBusy,
  isEditingBlocked,
  isAutoSavePending,
} from './state/workspace';
import { watchAutoSave } from './state/autosave';
import { transitionWorkspace } from './components/workspace-transition';
import { watchDevices } from './state/discovery';
import { actionsFor, bindingFor, labelFor, KEY_ACTIONS, type KeyAction } from './domain/keycodes';
import { changesBetween, MODEL_NAMES, type ModelId } from './domain/types';
import { decodeMacro, encodeMacro, type MacroStep } from './domain/macros';
import { exportProfile, parseProfile, type Profile } from './domain/profiles';
import { listProfiles, removeProfile, saveProfile } from './state/database';

const navigation = [
  { id: 'keymap', title: '按键设置', icon: KeyboardIcon },
  { id: 'macros', title: '宏编辑器', icon: Command },
  { id: 'settings', title: '设备设置', icon: SlidersHorizontal },
  { id: 'profiles', title: '配置管理', icon: FolderCog },
  { id: 'test', title: '按键测试', icon: MonitorCheck },
] as const;
function download(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ConnectionBadge() {
  const { connection, operation } = useWorkspace();
  return (
    <span className={`connection-badge ${connection}`}>
      <span className="status-dot" />
      {operation === 'connecting'
        ? '正在连接'
        : connection === 'device'
          ? 'USB 已连接'
          : connection === 'demo'
            ? '演示模式'
            : '等待连接'}
    </span>
  );
}
function Button({
  children,
  onClick,
  disabled,
  primary = false,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`button ${primary ? 'primary' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

export default function App() {
  const s = useWorkspace();
  const [help, setHelp] = useState(false);
  const [review, setReview] = useState(false);
  const [initialDemo] = useState<ModelId | null>(() => {
    const model = new URLSearchParams(window.location.search).get('demo');
    return model === 'neo75cu' || model === 'tofu-pad' ? model : null;
  });
  useEffect(watchAutoSave, []);
  useEffect(() => {
    // A dedicated demo tab must not claim an already-authorized keyboard.
    if (initialDemo) {
      void useWorkspace.getState().connect(initialDemo, true);
      return;
    }
    return watchDevices();
  }, [initialDemo]);
  const hub = s.page === 'devices';
  const inWorkspace = s.workspaceOpen;
  const unsaved = hasUnsavedDrafts(s);
  const dirty = isDirty(s);
  const pendingMacros = Object.keys(s.macroDrafts).length;
  const busy = isWorkspaceBusy(s);
  const editingBlocked = isEditingBlocked(s);
  const manualSave = !s.autoSave || s.requiresReview;
  const changes = useMemo(() => changesBetween(s.baseline, s.draft), [s.baseline, s.draft]);
  const macroChanges = s.draft.macros.filter(
    (m, i) => JSON.stringify(m) !== JSON.stringify(s.baseline.macros[i]),
  ).length;
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (unsaved || busy) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [unsaved, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        s.page !== 'keymap' ||
        help ||
        review ||
        e.defaultPrevented ||
        !(e.ctrlKey || e.metaKey) ||
        e.key.toLowerCase() !== 'z' ||
        (e.target instanceof HTMLElement &&
          (e.target.matches('input,textarea,select') || e.target.isContentEditable))
      )
        return;
      e.preventDefault();
      if (e.shiftKey) s.redo();
      else s.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.undo, s.redo, s.page, help, review]);
  const openDemo = () => {
    if (useWorkspace.getState().sessions.neo75cu?.connection === 'device') {
      const url = new URL(window.location.href);
      url.searchParams.set('demo', 'neo75cu');
      url.hash = '';
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    void s.connect('neo75cu', true);
  };
  return (
    <div
      className={`app-shell ${inWorkspace ? 'workspace-view' : 'hub-view'} ${hub ? 'device-center-view' : ''}`}
    >
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      {inWorkspace && (
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            aria-label="VIAPP 工作台"
            onClick={(e) => {
              e.preventDefault();
              transitionWorkspace(() => s.setPage('devices'));
            }}
          >
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
            <span>
              viapp<span className="brand-dot">.</span>
            </span>
          </a>
          {inWorkspace && <div className="nav-label">{s.draft.name}</div>}
          <nav aria-label="主导航">
            <button
              className={`nav-item ${hub ? 'active' : ''}`}
              aria-label="设备中心"
              onClick={() => transitionWorkspace(() => s.setPage('devices'))}
              disabled={busy}
            >
              <LayoutGrid size={19} />
              <span>设备中心</span>
              {hub && <ChevronRight size={16} />}
            </button>
            {navigation
              .filter((item) => item.id !== 'macros' || s.draft.macros.length > 0)
              .map((item) => (
                <button
                  key={item.id}
                  aria-label={item.title}
                  className={`nav-item ${s.page === item.id ? 'active' : ''}`}
                  onClick={() => s.setPage(item.id)}
                  disabled={busy}
                  aria-current={s.page === item.id ? 'page' : undefined}
                >
                  <item.icon size={19} />
                  <span>{item.title}</span>
                  {item.id === s.page && <ChevronRight size={16} />}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <button className="help-button" onClick={() => setHelp(true)}>
              <CircleHelp size={17} />
              连接帮助
              <ArrowRight size={15} />
            </button>
            <div className="sidebar-version">
              VIAPP <span>v{version}</span>
            </div>
          </div>
        </aside>
      )}
      <div className="main-shell">
        <header className="topbar">
          {!inWorkspace && (
            <a
              className="brand topbar-brand"
              href="#"
              aria-label="VIAPP 设备中心"
              onClick={(e) => {
                e.preventDefault();
                transitionWorkspace(() => s.setPage('devices'));
              }}
            >
              <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
              <span>
                viapp<span className="brand-dot">.</span>
              </span>
            </a>
          )}
          {inWorkspace && (
            <div className="breadcrumb">
              <button
                onClick={() => transitionWorkspace(() => s.setPage('devices'))}
                disabled={busy}
              >
                设备中心
              </button>
              {!hub && (
                <>
                  <ChevronRight size={14} />
                  {inWorkspace && <span>{s.draft.name} / </span>}
                  <strong>{navigation.find((n) => n.id === s.page)?.title}</strong>
                </>
              )}
            </div>
          )}
          <div className="topbar-right">
            {!inWorkspace && (
              <nav className="hub-tools" aria-label="主导航">
                <button onClick={() => setHelp(true)} aria-label="连接帮助" title="连接帮助">
                  <CircleHelp size={19} />
                </button>
              </nav>
            )}
            {inWorkspace && <ConnectionBadge />}
          </div>
        </header>
        <main id="main" className="main-content">
          <div className={`page-heading ${hub ? 'visually-hidden' : ''}`}>
            <div>
              <h1>
                {hub
                  ? '设备中心'
                  : s.page === 'keymap'
                    ? s.draft.name
                    : navigation.find((n) => n.id === s.page)?.title}
              </h1>
            </div>
            <div className="heading-actions">
              {inWorkspace && (
                <Button
                  onClick={() => transitionWorkspace(() => s.setPage('devices'))}
                  disabled={busy}
                  aria-label="返回设备中心"
                >
                  <ChevronLeft size={16} />
                  设备中心
                </Button>
              )}
              {inWorkspace && s.connection !== 'offline' && (
                <Button onClick={() => void s.disconnect()} disabled={busy} aria-label="断开设备">
                  <Unplug size={16} />
                </Button>
              )}
              {!hub && s.connection === 'offline' && inWorkspace && (
                <Button
                  primary
                  onClick={() => void s.authorize(s.model === 'tofu-pad' ? 'serial' : 'hid')}
                  disabled={busy}
                >
                  {busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}连接键盘
                </Button>
              )}
            </div>
          </div>
          {inWorkspace && s.connection === 'offline' && (
            <div className="info-banner">
              <Info size={17} />
              <span>
                <strong>离线草稿</strong> 重新连接后可保存。
              </span>
            </div>
          )}
          {inWorkspace && s.connection === 'demo' && (
            <div className="info-banner demo-banner">
              <WandSparkles size={17} />
              <span>
                <strong>演示模式</strong> 不会修改真实设备。
              </span>
              <button
                onClick={() => transitionWorkspace(() => s.setPage('devices'))}
                disabled={busy}
              >
                返回设备中心 <ArrowRight size={14} />
              </button>
            </div>
          )}
          {inWorkspace && s.draft.locked && (
            <div className="alert error" role="status">
              <Info size={18} />
              <span>设备已锁定，请按原厂说明解锁后重新读取。</span>
            </div>
          )}
          {inWorkspace && s.draft.firmwareUnsaved && (
            <div className="alert error" role="status">
              <Info size={18} />
              <span>键盘中有未保存配置。</span>
              <button onClick={() => s.setPage('settings')} disabled={busy}>
                前往处理
              </button>
            </div>
          )}
          {(s.error || s.notice) && (
            <div
              className={`alert ${s.error ? 'error' : 'success'}`}
              role={s.error ? 'alert' : 'status'}
            >
              {s.error ? <Info size={19} /> : <CheckCheck size={19} />}
              <span>{s.error || s.notice}</span>
              <button onClick={s.dismiss} aria-label="关闭提示">
                <X size={16} />
              </button>
            </div>
          )}
          {hub && <DeviceHub onDemo={openDemo} />}
          {s.page === 'keymap' && <KeymapPage key={s.model} />}
          {s.page === 'macros' && <MacrosPage />}
          {s.page === 'settings' && inWorkspace && <DeviceSettings key={s.model} />}
          {s.page === 'profiles' && inWorkspace && <ProfilesPage key={s.model} />}
          {s.page === 'test' && inWorkspace && (
            <TesterPage key={s.model} suspended={help || review} />
          )}
          {inWorkspace && (
            <footer className="workspace-footer">
              <button onClick={() => setHelp(true)}>
                使用说明 <ArrowRight size={13} />
              </button>
            </footer>
          )}
        </main>
        {inWorkspace && (
          <div className="save-bar">
            <div className="save-state" role="status" aria-live="polite" aria-atomic="true">
              {busy ? (
                <LoaderCircle className="spin" size={19} />
              ) : dirty || pendingMacros || s.draft.firmwareUnsaved ? (
                <span className="unsaved-dot" />
              ) : (
                <CheckCheck size={19} />
              )}
              <div>
                <strong>
                  {s.autoSaving || isAutoSavePending(s)
                    ? '正在保存…'
                    : busy
                      ? s.progress || '正在处理'
                      : s.autoSaveBlocked
                        ? '保存失败，修改已保留'
                        : s.requiresReview && dirty
                          ? '配置已载入，待确认保存'
                          : pendingMacros
                            ? `${pendingMacros} 个宏尚未保存`
                            : s.draft.firmwareUnsaved
                              ? '键盘中有未保存配置'
                              : dirty
                                ? `${[changes.length && `${changes.length} 个按键`, macroChanges && `${macroChanges} 个宏`, layersChanged(s.baseline, s.draft) && '图层', s.baseline.layoutOptions !== s.draft.layoutOptions && '配列'].filter(Boolean).join('、')}尚未保存`
                                : s.connection === 'device'
                                  ? '已保存到键盘'
                                  : s.connection === 'demo'
                                    ? '演示配置已同步'
                                    : '设备未连接'}
                </strong>
              </div>
            </div>
            <div className="save-actions">
              {pendingMacros > 0 && s.page !== 'macros' && (
                <Button onClick={() => s.setPage('macros')} disabled={busy}>
                  继续编辑宏
                </Button>
              )}
              <label className="autosave-toggle" title="改键后自动保存到键盘">
                <input
                  type="checkbox"
                  checked={s.autoSave}
                  onChange={(e) => s.setAutoSave(e.target.checked)}
                  disabled={s.operation !== 'idle'}
                />
                自动保存
              </label>
              <Button
                onClick={s.undo}
                disabled={editingBlocked || !s.history.length}
                aria-label="撤销修改"
              >
                <Undo2 size={17} />
              </Button>
              <Button
                onClick={s.redo}
                disabled={editingBlocked || !s.future.length}
                aria-label="重做修改"
              >
                <Redo2 size={17} />
              </Button>
              {manualSave && (
                <Button className="reset-draft" onClick={s.resetDraft} disabled={busy || !dirty}>
                  <RotateCcw size={15} />
                  撤销全部
                </Button>
              )}
              {s.autoSaveBlocked ? (
                <Button
                  onClick={() => void s.refresh()}
                  disabled={busy || s.connection === 'offline'}
                >
                  <RotateCcw size={15} />
                  重新读取
                </Button>
              ) : (
                manualSave && (
                  <Button
                    primary
                    onClick={() => setReview(true)}
                    disabled={busy || !dirty || s.connection === 'offline' || s.draft.locked}
                  >
                    <Check size={17} />
                    {s.connection === 'demo' ? '保存演示配置' : '保存到键盘'}
                  </Button>
                )
              )}
            </div>
          </div>
        )}
      </div>
      <Modal
        open={review}
        onOpenChange={setReview}
        title="确认修改"
        description="保存前自动备份，写入后校验。"
      >
        <div className="review-list">
          {changes.map((change) => (
            <div key={`${change.layerId}-${change.index}`}>
              <span>
                层 {change.layerId} · 位置 {change.index}
              </span>
              <strong>{change.before ? labelFor(change.before, s.baseline) : '新增'}</strong>
              <ArrowRight size={14} />
              <strong className="new-binding">{labelFor(change.after, s.draft)}</strong>
            </div>
          ))}
          {macroChanges > 0 && <p>更新 {macroChanges} 个宏。</p>}
          {layersChanged(s.baseline, s.draft) && <p>更新图层顺序或数量。</p>}
          {s.baseline.layoutOptions !== s.draft.layoutOptions && <p>更新物理配列。</p>}
        </div>
        <div className="modal-actions">
          <Button onClick={() => setReview(false)}>继续编辑</Button>
          <Button
            primary
            disabled={busy || s.connection === 'offline' || s.draft.locked}
            onClick={() => {
              setReview(false);
              void s.apply();
            }}
            data-testid="confirm-save"
          >
            确认保存 <Check size={16} />
          </Button>
        </div>
      </Modal>
      <Modal
        open={help}
        onOpenChange={setHelp}
        title="连接帮助"
        description="使用桌面版 Chrome / Edge 打开网页。"
      >
        <div className="help-content">
          <h3>连接设备</h3>
          <ol>
            <li>接入 USB 数据线或受支持的 2.4 GHz 接收器，并切换到对应模式。</li>
            <li>点击「添加设备」，选择 VIA 或 ZMK，再在浏览器窗口中选择设备。</li>
            <li>点击已连接的设备卡片，开始配置。</li>
          </ol>
          <p>同一浏览器保留授权后，打开网页或再次插入设备会自动识别。</p>
          <h3>无法连接</h3>
          <p>
            授权列表为空时，核对菜单中的支持型号与连接模式。确认线缆支持数据传输，并关闭其他配置页面。设备提示锁定时，请按原厂说明解锁。Linux
            可能需要设置 USB 或串口访问权限。
          </p>
          <h3>目前支持的型号</h3>
          <ul className="help-models">
            <li>
              <strong>{MODEL_NAMES.neo75cu}</strong>
              <span>原装三模 PCB</span>
            </li>
            <li>
              <strong>{MODEL_NAMES['tofu-pad']}</strong>
              <span>原装双模 PCB</span>
            </li>
          </ul>
          <p>USB 有线连接已验证；2.4 GHz 接收器待验证。蓝牙不支持网页配置。</p>
          <div className="help-links">
            <a href="https://github.com/ZackLeo219/viapp#使用" target="_blank" rel="noreferrer">
              使用文档 ↗
            </a>
            <a href="https://github.com/ZackLeo219/viapp/issues" target="_blank" rel="noreferrer">
              反馈问题 ↗
            </a>
          </div>
        </div>
      </Modal>
      {needRefresh && (
        <div className="update-notice" role="status">
          <span>发现新版本</span>
          <Button disabled={busy || unsaved} onClick={() => void updateServiceWorker(true)}>
            刷新更新
          </Button>
          {unsaved && <small>请先保存或导出草稿</small>}
        </div>
      )}
    </div>
  );
}

function DeviceHub({ onDemo }: { onDemo(): void }) {
  const s = useWorkspace();
  const busy = isWorkspaceBusy(s);
  const devices = Object.values(s.sessions).filter((session) => session.connection === 'device');
  return (
    <div className={`device-hub ${devices.length ? 'has-devices' : 'empty-hub'}`}>
      <div className="hub-devices-stage">
        {devices.length ? (
          <div className="connected-devices">
            {devices.map((session) => (
              <article className="connected-card" key={session.model}>
                <button
                  className="connected-card-open"
                  onClick={() => transitionWorkspace(() => s.openDevice(session.model))}
                  disabled={busy}
                  aria-label={`${session.draft.name} 开始配置`}
                >
                  <div className="connected-visual">
                    <Keyboard
                      snapshot={session.draft}
                      layerId={session.layerId}
                      miniature
                      transitionName={`keyboard-${session.model}`}
                    />
                  </div>
                  <div className="connected-card-bottom">
                    <div>
                      <h2>{session.draft.name}</h2>
                      <p>
                        <span className="status-dot live" />
                        USB 已连接
                        {(isDirty(session) || Object.keys(session.macroDrafts).length > 0) && (
                          <span className="draft-tag">未保存</span>
                        )}
                      </p>
                    </div>
                    <ArrowRight size={20} />
                  </div>
                </button>
                <button
                  className="connected-card-disconnect"
                  onClick={() => void s.disconnect(session.model)}
                  disabled={busy}
                  aria-label={`断开 ${session.draft.name}`}
                >
                  <Unplug size={14} />
                  断开
                </button>
              </article>
            ))}
          </div>
        ) : (
          <IdleKeyboard />
        )}
      </div>
      <div className="hub-connect">
        <DeviceConnect busy={busy} onConnect={s.authorize} />
        {!devices.length && <h2>请连接设备</h2>}
        <p>通过 USB 数据线或受支持的 2.4 GHz 接收器连接</p>
      </div>
      <div className="hub-bottom">
        <button onClick={onDemo} disabled={busy}>
          体验演示 <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}

function KeymapPage() {
  const s = useWorkspace();
  const [editorMode, setEditorMode] = useState<'basic' | 'shortcut' | 'dual'>('basic');
  const [capture, setCapture] = useState<{
    index: number;
    layerId: number;
    attempt: number;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('常用');
  useEffect(() => {
    const finishEditing = () => {
      setCapture(null);
      s.selectKey(null);
    };
    const outsideControl = (event: PointerEvent) => {
      const target = event.target;
      // Searching, choosing a function and using editor controls keep the target.
      if (
        target instanceof Element &&
        target.closest(
          'button, a, input, textarea, select, label, [role="button"], [role="tab"], .key-capture',
        )
      )
        return;
      finishEditing();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finishEditing();
    };
    document.addEventListener('pointerdown', outsideControl, true);
    window.addEventListener('blur', finishEditing);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('pointerdown', outsideControl, true);
      window.removeEventListener('blur', finishEditing);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [s.selectKey]);
  const actions = useMemo(() => actionsFor(s.draft), [s.draft]);
  const layer = s.draft.layers.find((l) => l.id === s.layerId)!;
  const selected = s.selectedIndex === null ? null : layer.bindings[s.selectedIndex];
  const autoCapture = capture?.index === s.selectedIndex && capture?.layerId === s.layerId;
  const search = query.trim().toLowerCase();
  const filtered = actions.filter(
    (a) =>
      (search || category === '全部' || a.category === category) &&
      `${a.label} ${a.description}`.toLowerCase().includes(search),
  );
  const categories = [
    '全部',
    '常用',
    '字母数字',
    '符号',
    '功能',
    '导航',
    '修饰键',
    '数字键盘',
    '媒体',
    '层',
    '设备',
    '鼠标',
    ...(s.draft.macros.length ? ['宏'] : []),
  ];
  function assign(action: KeyAction) {
    const binding = bindingFor(action, s.draft);
    if (binding && s.selectedIndex !== null) s.edit(s.selectedIndex, binding);
  }
  return (
    <div className="editor-grid">
      <section className="panel keyboard-panel">
        <div className="panel-heading">
          <div>
            <h2>
              {s.draft.name}
              <span className="subtle-tag">{s.draft.keys.length} 键</span>
            </h2>
          </div>
          <Button
            onClick={() => void s.refresh()}
            disabled={isWorkspaceBusy(s) || s.connection === 'offline'}
            aria-label="重新读取设备"
          >
            <RotateCcw size={16} />
          </Button>
        </div>
        <div className="layer-bar">
          <span>
            <Layers3 size={15} />
            图层
          </span>
          <div className="layer-tabs" role="tablist" aria-label="键盘图层">
            {s.draft.layers.map((l, index) => (
              <button
                key={l.id}
                role="tab"
                aria-selected={s.layerId === l.id}
                className={s.layerId === l.id ? 'active' : ''}
                onClick={() => {
                  setCapture(null);
                  s.selectLayer(l.id);
                }}
              >
                <span>{index.toString().padStart(2, '0')}</span>
                {l.name}
              </button>
            ))}
          </div>
        </div>
        <div className="keyboard-stage">
          <div className="stage-label">
            <span>{s.model === 'neo75cu' ? '75%' : '数字键盘'}</span>
            <span>{s.layerId === s.draft.layers[0].id ? '基础层' : '功能层'}</span>
          </div>
          <Keyboard
            transitionName={`keyboard-${s.model}`}
            snapshot={s.draft}
            baseline={s.baseline}
            layerId={s.layerId}
            selected={s.selectedIndex}
            onSelect={(index, activate = true) => {
              s.selectKey(index);
              if (activate) setEditorMode('basic');
              setCapture((previous) =>
                activate
                  ? { index, layerId: s.layerId, attempt: (previous?.attempt ?? 0) + 1 }
                  : null,
              );
            }}
          />
          <div className="keyboard-legend">
            <span>
              <i className="legend-selected" />
              当前选择
            </span>
            <span>
              <i className="legend-changed" />
              待保存修改
            </span>
            <span>▽ 继承下一有效层</span>
          </div>
        </div>
        <div className="editor-tip">
          <MousePointer2 size={17} />
          <span>点选键位，再按下目标键。</span>
        </div>
      </section>
      <aside className="panel inspector">
        {!selected ? (
          <div className="inspector-empty">
            <MousePointer2 size={28} />
            <p>选择一个按键</p>
          </div>
        ) : (
          <>
            <div className="panel-heading">
              <div>
                <h2>按键功能</h2>
                <p>
                  {selected ? `当前选择 · ${labelFor(selected, s.draft)}` : '选择一个按键开始编辑'}
                </p>
              </div>
              <span className="inspector-key">
                {selected ? labelFor(selected, s.draft) : <MousePointer2 size={21} />}
              </span>
            </div>
            <div className="binding-tabs" role="group" aria-label="改键类型">
              {(
                [
                  ['basic', '按键'],
                  ['shortcut', '快捷键'],
                  ...(s.draft.behaviors.some((b) =>
                    ['layer-tap', 'mod-tap'].includes(advancedKind(b) ?? ''),
                  )
                    ? [['dual', '双功能']]
                    : []),
                ] as const
              ).map(([id, title]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={editorMode === id}
                  onClick={() => {
                    setEditorMode(id as typeof editorMode);
                    setCapture(null);
                  }}
                >
                  {title}
                </button>
              ))}
            </div>
            {editorMode === 'shortcut' && (
              <ShortcutEditor
                key={`${s.layerId}-${s.selectedIndex}`}
                snapshot={s.draft}
                selected={selected}
                disabled={isEditingBlocked(s) || s.draft.locked}
                onApply={(binding) => s.selectedIndex !== null && s.edit(s.selectedIndex, binding)}
              />
            )}
            {editorMode === 'dual' && (
              <DualRoleEditor
                key={`${s.layerId}-${s.selectedIndex}`}
                snapshot={s.draft}
                selected={selected}
                disabled={isEditingBlocked(s) || s.draft.locked}
                onApply={(binding) => s.selectedIndex !== null && s.edit(s.selectedIndex, binding)}
              />
            )}
            {editorMode === 'basic' && (
              <>
                <KeyCapture
                  startRequest={autoCapture ? capture.attempt : null}
                  actions={actions}
                  onAssign={assign}
                  disabled={isEditingBlocked(s)}
                />
                <label className="search-field">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索按键或功能…"
                    aria-label="搜索按键功能"
                  />
                  {query && (
                    <button onClick={() => setQuery('')} aria-label="清空搜索">
                      <X size={14} />
                    </button>
                  )}
                </label>
                <div className="category-list" aria-label="功能分类">
                  {categories
                    .filter((c) => c === '全部' || actions.some((a) => a.category === c))
                    .map((c) => (
                      <button
                        key={c}
                        aria-pressed={category === c}
                        className={category === c ? 'active' : ''}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                </div>
                <div className="action-grid">
                  {filtered.map((a) => (
                    <button
                      key={a.id}
                      disabled={!selected || isEditingBlocked(s)}
                      onClick={() => assign(a)}
                      title={a.description}
                      aria-label={`设为 ${a.description}`}
                    >
                      <span>{a.label}</span>
                    </button>
                  ))}
                  {!filtered.length && (
                    <div className="empty-search">
                      <Search size={23} />
                      <p>没有匹配的功能</p>
                      <button
                        onClick={() => {
                          setQuery('');
                          setCategory('全部');
                        }}
                      >
                        清空筛选
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function MacrosPage() {
  const s = useWorkspace();
  const [index, setIndex] = useState(() => Number(Object.keys(s.macroDrafts)[0] ?? 0));
  const decoded = decodeMacro(s.draft.macros[index] ?? [], s.draft.protocolVersion);
  const unknown = decoded === null;
  const steps = s.macroDrafts[index] ?? decoded ?? [];
  const setSteps = (next: MacroStep[] | ((steps: MacroStep[]) => MacroStep[])) =>
    s.stageMacro(index, typeof next === 'function' ? next(steps) : next);
  if (s.draft.protocol === 'zmk')
    return (
      <section className="panel feature-note">
        <div className="feature-icon">
          <Command size={30} />
        </div>
        <h2>当前固件不支持编辑宏</h2>
        <p>已有宏可在「按键设置 → 设备」中选择。</p>
        <Button onClick={() => s.setPage('keymap')}>
          返回按键设置 <ArrowRight size={16} />
        </Button>
      </section>
    );
  const used = s.draft.macros.reduce((n, m) => n + m.length + 1, 0);
  const update = (i: number, step: MacroStep) =>
    setSteps((old) => old.map((s, j) => (i === j ? step : s)));
  return (
    <section className="panel macro-panel">
      <div className="panel-heading">
        <div>
          <h2>宏序列</h2>
          {!s.autoSave && <p>应用到草稿后，点击「保存到键盘」。</p>}
        </div>
        <span className="capacity">
          {used} / {Math.max(0, s.draft.macroBufferSize - 1)} bytes
        </span>
      </div>
      <div className="macro-layout">
        <div className="macro-slots">
          {s.draft.macros.map((m, i) => (
            <button
              key={i}
              className={index === i ? 'active' : ''}
              onClick={() => setIndex(i)}
              aria-pressed={index === i}
            >
              <Command size={15} />
              <span>宏 {i + 1}</span>
              <small>{s.macroDrafts[i] ? '未保存' : m.length ? `${m.length} B` : '空'}</small>
            </button>
          ))}
        </div>
        <fieldset className="macro-editor" disabled={isEditingBlocked(s)}>
          <div className="section-title">
            <h3>宏 {index + 1}</h3>
            <span className="subtle-tag">M{index}</span>
            {s.macroDrafts[index] && (
              <Button className="macro-discard" onClick={() => s.discardMacro(index)}>
                放弃编辑
              </Button>
            )}
          </div>
          {unknown && <div className="alert error">此宏包含未知编码，编辑并应用会覆盖原内容。</div>}
          {!steps.length && (
            <div className="macro-empty">
              <Command size={32} />
              <strong>暂无动作</strong>
            </div>
          )}
          <div className="macro-steps">
            {steps.map((step, i) => (
              <div className="macro-step" key={i}>
                <span className="step-number">{String(i + 1).padStart(2, '0')}</span>
                <select
                  aria-label={`动作 ${i + 1} 类型`}
                  value={step.type}
                  onChange={(e) => {
                    const t = e.target.value as MacroStep['type'];
                    update(
                      i,
                      t === 'text'
                        ? { type: t, text: '' }
                        : t === 'delay'
                          ? { type: t, ms: 100 }
                          : { type: t, key: 40 },
                    );
                  }}
                >
                  <option value="text">输入文本</option>
                  <option value="tap">点按</option>
                  <option value="down">按下</option>
                  <option value="up">释放</option>
                  {s.draft.protocolVersion >= 11 && <option value="delay">延时</option>}
                </select>
                {step.type === 'text' ? (
                  <input
                    aria-label={`动作 ${i + 1} 文本`}
                    placeholder="英文、数字或符号"
                    maxLength={Math.max(0, s.draft.macroBufferSize - 1)}
                    value={step.text}
                    onChange={(e) => update(i, { ...step, text: e.target.value })}
                  />
                ) : step.type === 'delay' ? (
                  <label className="delay-input">
                    <input
                      type="number"
                      min="0"
                      max="9999"
                      aria-label={`动作 ${i + 1} 延时`}
                      value={step.ms}
                      onChange={(e) => update(i, { ...step, ms: Number(e.target.value) })}
                    />
                    ms
                  </label>
                ) : (
                  <select
                    aria-label={`动作 ${i + 1} 按键`}
                    value={step.key}
                    onChange={(e) => update(i, { ...step, key: Number(e.target.value) })}
                  >
                    {KEY_ACTIONS.filter((a) => a.hid && !a.page).map((a) => (
                      <option key={a.id} value={a.hid}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="icon-button"
                  aria-label={`删除动作 ${i + 1}`}
                  onClick={() => setSteps((old) => old.filter((_, j) => j !== i))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="macro-add">
            <Button onClick={() => setSteps([...steps, { type: 'text', text: '' }])}>
              ＋ 文本
            </Button>
            <Button onClick={() => setSteps([...steps, { type: 'tap', key: 40 }])}>＋ 按键</Button>
            {s.draft.protocolVersion >= 11 && (
              <Button onClick={() => setSteps([...steps, { type: 'delay', ms: 100 }])}>
                ＋ 延时
              </Button>
            )}
          </div>
          <div className="macro-bottom">
            <p>
              文本宏按英文键盘布局发送。
              <br />
              组合键需要成对添加“按下”和“释放”。
            </p>
            <Button
              primary
              disabled={isEditingBlocked(s) || !s.draft.macros.length}
              onClick={() => {
                try {
                  const encoded = encodeMacro(steps, s.draft.protocolVersion);
                  const size = used - s.draft.macros[index].length + encoded.length;
                  if (size >= s.draft.macroBufferSize) throw new Error('宏总长度超出设备容量。');
                  s.editMacro(index, encoded);
                  if (!s.autoSave || s.requiresReview) s.notify('宏已应用到草稿。');
                } catch (e) {
                  s.report(e);
                }
              }}
            >
              {s.autoSave && !s.requiresReview ? '保存宏' : '应用到草稿'} <Check size={16} />
            </Button>
          </div>
        </fieldset>
      </div>
    </section>
  );
}

function ProfilesPage() {
  const s = useWorkspace();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const refresh = () =>
    listProfiles()
      .then((items) => setProfiles(items.filter((p) => p.snapshot.model === s.model)))
      .catch(s.report);
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <div className="profiles-page">
      <section className="panel onboard-panel">
        <div className="panel-heading">
          <div>
            <h2>{s.connection === 'demo' ? '演示配置' : '键盘配置'}</h2>
            <p>{s.connection === 'demo' ? '模拟设备' : '保存在键盘上。'}</p>
          </div>
        </div>
        <div className="onboard-config">
          <div className="onboard-icon">
            <KeyboardIcon size={24} />
          </div>
          <div>
            <h3>{s.draft.name}</h3>
            <p>
              {s.baseline.layers.length} 个图层 · {s.baseline.keys.length} 键
            </p>
          </div>
          <span className="onboard-status">
            {s.connection === 'offline' ? (
              '未连接'
            ) : s.autoSaveBlocked ? (
              '保存失败'
            ) : s.baseline.firmwareUnsaved ? (
              '设备尚未保存'
            ) : isDirty(s) || Object.keys(s.macroDrafts).length > 0 ? (
              '有待保存修改'
            ) : (
              <>
                <CheckCheck size={15} />
                已同步
              </>
            )}
          </span>
        </div>
      </section>
      <section className="panel profiles-panel">
        <div className="panel-heading">
          <div>
            <h2>本地配置</h2>
            <p>保存在此浏览器。</p>
          </div>
          <Button onClick={() => file.current?.click()}>
            <ArrowUpFromLine size={16} />
            导入配置
          </Button>
          <input
            ref={file}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            aria-label="导入配置文件"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > 2_000_000) {
                s.report('配置文件不能超过 2 MB。');
                return;
              }
              void f
                .text()
                .then(parseProfile)
                .then((p) => {
                  if (p.snapshot.model !== s.model)
                    throw new Error(
                      `此配置属于 ${MODEL_NAMES[p.snapshot.model]}，请在对应设备中导入。`,
                    );
                  return saveProfile(p.name, p.snapshot);
                })
                .then(() => {
                  void refresh();
                  s.notify('配置已导入。');
                })
                .catch(s.report);
            }}
          />
        </div>
        {s.workspaceOpen && (
          <form
            className="save-profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile(name, s.draft)
                .then(() => {
                  setName('');
                  void refresh();
                  s.notify('已保存到此浏览器。');
                })
                .catch(s.report);
            }}
          >
            <FolderCog size={20} />
            <input
              aria-label="配置名称"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="配置名称"
            />
            <Button type="submit" primary disabled={!name.trim()}>
              保存为新配置
            </Button>
          </form>
        )}
        <div className="profile-list">
          {profiles.length === 0 ? (
            <div className="empty-state">
              <FolderCog size={36} />
              <h3>暂无本地配置</h3>
            </div>
          ) : (
            profiles.map((p) => (
              <article className="profile-row" key={p.id}>
                <div className={`profile-icon ${p.kind}`}>
                  {p.kind === 'backup' ? <History size={22} /> : <FileJson size={22} />}
                </div>
                <div className="profile-info">
                  <h3>
                    {p.name}
                    <span className="subtle-tag">
                      {p.kind === 'backup' ? '自动备份' : p.kind === 'draft' ? '草稿' : '配置'}
                    </span>
                  </h3>
                  <p>
                    {MODEL_NAMES[p.snapshot.model]} ·{' '}
                    {new Date(p.createdAt).toLocaleString('zh-CN')}{' '}
                    {p.snapshot.identity.startsWith('DEMO:') ? '· 演示配置' : ''}
                  </p>
                </div>
                <div className="profile-actions">
                  <Button
                    disabled={isWorkspaceBusy(s)}
                    onClick={() => {
                      try {
                        s.loadProfile(p.snapshot);
                        s.setPage('keymap');
                      } catch (e) {
                        s.report(e);
                      }
                    }}
                  >
                    载入配置
                  </Button>
                  <Button
                    onClick={() =>
                      download(
                        `viapp-${p.snapshot.model}-${p.createdAt.slice(0, 10)}.json`,
                        exportProfile(p),
                      )
                    }
                    aria-label={`导出 ${p.name}`}
                  >
                    <ArrowDownToLine size={16} />
                  </Button>
                  <Button onClick={() => setDeleting(p)} aria-label={`删除 ${p.name}`}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
        <Modal
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          title="删除这份本地配置？"
          description={deleting?.name ?? ''}
        >
          <p>只删除此浏览器中的副本。</p>
          <div className="modal-actions">
            <Button onClick={() => setDeleting(null)}>保留</Button>
            <Button
              onClick={() => {
                if (deleting)
                  void removeProfile(deleting.id)
                    .then(() => {
                      setDeleting(null);
                      void refresh();
                    })
                    .catch(s.report);
              }}
            >
              删除配置
            </Button>
          </div>
        </Modal>
      </section>
    </div>
  );
}
