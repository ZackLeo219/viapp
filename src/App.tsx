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
  Copy,
  FileJson,
  FolderHeart,
  History,
  Info,
  Keyboard as KeyboardIcon,
  Layers3,
  LayoutGrid,
  LoaderCircle,
  MonitorCheck,
  MousePointer2,
  Plus,
  Radio,
  Redo2,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Undo2,
  Unplug,
  Usb,
  WandSparkles,
  X,
} from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Keyboard } from './components/Keyboard';
import { Modal } from './components/Modal';
import { useWorkspace, isDirty, hasUnsavedDrafts } from './state/workspace';
import { actionsFor, bindingFor, labelFor, KEY_ACTIONS, type KeyAction } from './domain/keycodes';
import { changesBetween, MODEL_NAMES, errorMessage, type ModelId } from './domain/types';
import { previewSnapshot } from './domain/demo';
import { decodeMacro, encodeMacro, type MacroStep } from './domain/macros';
import { exportProfile, parseProfile, type Profile } from './domain/profiles';
import { listProfiles, removeProfile, saveProfile } from './state/database';

const navigation = [
  { id: 'keymap', title: '按键设置', icon: KeyboardIcon },
  { id: 'macros', title: '宏编辑器', icon: Command },
  { id: 'profiles', title: '我的方案', icon: FolderHeart },
  { id: 'test', title: '按键测试', icon: MonitorCheck },
  { id: 'diagnostics', title: '连接诊断', icon: SlidersHorizontal },
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
  const [connectionDialog, setConnectionDialog] = useState<'device' | 'demo' | null>(null);
  const hub = s.page === 'devices';
  const inWorkspace = s.workspaceOpen;
  const unsaved = hasUnsavedDrafts(s);
  const dirty = isDirty(s);
  const busy = s.operation !== 'idle';
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
  }, [s.undo, s.redo, s.page]);
  const connect = (model: ModelId) => {
    void s.connect(model, connectionDialog === 'demo').then((ok) => {
      if (ok) setConnectionDialog(null);
    });
  };
  return (
    <div className={`app-shell ${inWorkspace ? 'workspace-view' : 'hub-view'}`}>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label="VIAPP 工作台"
          onClick={(e) => {
            e.preventDefault();
            s.setPage('devices');
          }}
        >
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <span>
            viapp<span className="brand-dot">.</span>
          </span>
          <span className="brand-tag">STUDIO</span>
        </a>
        <div className="sidebar-caption">YOUR KEYBOARD, YOUR WAY.</div>
        <div className="nav-label">{inWorkspace ? s.draft.name : '工作台'}</div>
        <nav aria-label="主导航">
          <button
            className={`nav-item ${hub ? 'active' : ''}`}
            aria-label="设备中心"
            onClick={() => s.setPage('devices')}
            disabled={busy}
          >
            <LayoutGrid size={19} />
            <span>设备中心</span>
            {hub && <ChevronRight size={16} />}
          </button>
          {navigation
            .filter((item) => inWorkspace || !['keymap', 'macros'].includes(item.id))
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
          <div className="local-card">
            <ShieldCheck size={23} />
            <strong>设置，留在你手里。</strong>
            <p>
              设备直连浏览器
              <br />
              方案保存在本机
            </p>
            <span>
              <i /> LOCAL FIRST
            </span>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            连接帮助与说明
            <ArrowRight size={15} />
          </button>
          <div className="sidebar-version">
            VIAPP STUDIO <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button onClick={() => s.setPage('devices')} disabled={busy}>
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
          <div className="topbar-right">
            <span className="local-indicator">
              <ShieldCheck size={14} /> 本地运行
            </span>
            {inWorkspace ? (
              <ConnectionBadge />
            ) : (
              <span className="connection-badge">
                <span className="status-dot" />
                {Object.values(s.sessions).filter((d) => d.connection === 'device').length}{' '}
                台设备已连接
              </span>
            )}
          </div>
        </header>
        <main id="main" className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{hub ? 'YOUR DEVICES' : 'MAKE IT YOURS'}</div>
              <h1>
                {hub
                  ? '设备中心'
                  : s.page === 'keymap'
                    ? s.draft.name
                    : navigation.find((n) => n.id === s.page)?.title}
              </h1>
              <p>
                {hub
                  ? '连接你的键盘，让习惯各就各位。'
                  : s.page === 'keymap'
                    ? '让每一次按下，都更顺手。'
                    : s.page === 'macros'
                      ? '把重复操作，交给一个按键。'
                      : s.page === 'profiles'
                        ? '保存你的习惯，也保留每一次修改的退路。'
                        : s.page === 'test'
                          ? '在浏览器里，检查每一次按下与释放。'
                          : '了解连接状态，让问题有迹可循。'}
              </p>
            </div>
            <div className="heading-actions">
              {inWorkspace && (
                <Button
                  onClick={() => s.setPage('devices')}
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
              {(!inWorkspace || s.connection === 'offline') && (
                <Button
                  primary
                  onClick={() => setConnectionDialog('device')}
                  disabled={busy}
                  data-testid="connect-device"
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
                <strong>离线草稿</strong> 当前配置已保留。重新连接后，确认设备状态再保存。
              </span>
            </div>
          )}
          {inWorkspace && s.connection === 'demo' && (
            <div className="info-banner demo-banner">
              <WandSparkles size={17} />
              <span>
                <strong>演示模式</strong> 可以体验编辑、保存与备份；所有操作仅作用于模拟设备。
              </span>
              <button onClick={() => s.setPage('devices')} disabled={busy}>
                返回设备中心 <ArrowRight size={14} />
              </button>
            </div>
          )}
          {inWorkspace && s.draft.locked && (
            <div className="alert error" role="status">
              <Info size={18} />
              <span>Studio 已锁定。请使用键盘原厂设置的解锁按键，然后点击重新读取。</span>
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
          {hub && (
            <DeviceHub
              onConnect={() => setConnectionDialog('device')}
              onDemo={() => setConnectionDialog('demo')}
            />
          )}
          {s.page === 'keymap' && <KeymapPage key={s.model} />}
          {s.page === 'macros' && <MacrosPage />}
          {s.page === 'profiles' && <ProfilesPage />}
          {s.page === 'test' && <TesterPage />}
          {s.page === 'diagnostics' && <DiagnosticsPage />}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={14} /> 只连接原装 PCB · 不上传按键配置
            </span>
            <button onClick={() => setHelp(true)}>
              使用说明 <ArrowRight size={13} />
            </button>
          </footer>
        </main>
        {inWorkspace && (
          <div className="save-bar">
            <div className="save-state">
              {busy ? (
                <LoaderCircle className="spin" size={19} />
              ) : dirty ? (
                <span className="unsaved-dot" />
              ) : (
                <CheckCheck size={19} />
              )}
              <div>
                <strong>
                  {busy
                    ? s.progress || '正在处理'
                    : dirty
                      ? `${changes.length} 个按键${macroChanges ? `、${macroChanges} 个宏` : ''}尚未保存`
                      : s.connection === 'device'
                        ? '与设备配置一致'
                        : '准备好，从一个按键开始'}
                </strong>
                <span>
                  {s.connection === 'demo'
                    ? '当前为演示模式，不会修改真实设备'
                    : '写入前自动备份，写入后读回校验'}
                </span>
              </div>
            </div>
            <div className="save-actions">
              <Button onClick={s.undo} disabled={busy || !s.history.length} aria-label="撤销修改">
                <Undo2 size={17} />
              </Button>
              <Button onClick={s.redo} disabled={busy || !s.future.length} aria-label="重做修改">
                <Redo2 size={17} />
              </Button>
              <Button onClick={s.resetDraft} disabled={busy || !dirty}>
                <RotateCcw size={15} />
                撤销全部
              </Button>
              <Button
                primary
                onClick={() => setReview(true)}
                disabled={busy || !dirty || s.connection === 'offline' || s.draft.locked}
              >
                <Check size={17} />
                {s.connection === 'demo' ? '保存演示配置' : '保存到键盘'}
              </Button>
            </div>
          </div>
        )}
      </div>
      <Modal
        open={connectionDialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConnectionDialog(null);
        }}
        title={connectionDialog === 'demo' ? '选择演示设备' : '连接你的键盘'}
        description={
          connectionDialog === 'demo'
            ? '使用示例配置体验工作台，不会连接或修改硬件。'
            : '插入 USB 数据线，选择型号，再在浏览器弹窗中确认设备。'
        }
      >
        <div className="connection-choices">
          {(['neo75cu', 'tofu-pad'] as ModelId[]).map((model) => (
            <button
              key={model}
              onClick={() => connect(model)}
              disabled={busy}
              aria-label={`${connectionDialog === 'demo' ? '演示' : '连接'} ${MODEL_NAMES[model]}`}
            >
              <div className="device-mini">
                <Keyboard snapshot={previewSnapshot(model)} layerId={0} miniature />
              </div>
              <div>
                <strong>{MODEL_NAMES[model]}</strong>
                <p>
                  {model === 'neo75cu'
                    ? '原装三模 PCB · 请切换到有线模式'
                    : '原装双模 PCB · USB 数据线连接'}
                </p>
              </div>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
        {busy && (
          <p className="connecting-progress" role="status">
            <LoaderCircle size={16} className="spin" />
            {s.progress}
          </p>
        )}
        {s.error && (
          <p className="connection-error" role="alert">
            {s.error}
          </p>
        )}
      </Modal>
      <Modal
        open={review}
        onOpenChange={setReview}
        title="检查这次修改"
        description="确认后先保存一份当前配置的本地备份，再写入并读回校验。"
      >
        <div className="review-list">
          {changes.map((change) => (
            <div key={`${change.layerId}-${change.index}`}>
              <span>
                层 {change.layerId} · 位置 {change.index}
              </span>
              <strong>{labelFor(change.before, s.baseline)}</strong>
              <ArrowRight size={14} />
              <strong className="new-binding">{labelFor(change.after, s.draft)}</strong>
            </div>
          ))}
          {macroChanges > 0 && <p>同时更新 {macroChanges} 个宏槽位。</p>}
        </div>
        <div className="modal-actions">
          <Button onClick={() => setReview(false)}>继续编辑</Button>
          <Button
            primary
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
        title="连接你的键盘"
        description="支持桌面版 Chrome / Edge，通过 USB 数据线连接。"
      >
        <div className="help-content">
          <h3>Neo75 Cu</h3>
          <p>连接数据线，并切换到 USB 有线模式。原装三模 PCB 会由网页自动识别，无需导入 JSON。</p>
          <h3>TOFU PAD</h3>
          <p>
            连接数据线后优先使用 USB。浏览器选择原装 TOFU PAD 对应的 USB 串口。如果固件要求 Studio
            解锁，请按原厂说明执行解锁，网页会显示当前状态。
          </p>
          <h3>找不到设备？</h3>
          <p>
            确认使用能传输数据的线缆，关闭 VIA、ZMK Studio 等其他配置页面后重试。Linux
            用户还可能需要 HID / 串口访问权限。
          </p>
          <h3>连接与功能范围</h3>
          <p>
            首版支持两款原装 PCB 的 USB 配置；蓝牙配置不提供，2.4G
            尚未验证。功能受原厂固件限制：Neo75 Cu 的高级组合键存在限制；TOFU PAD
            可改键和调用已有行为，不能通过 Studio 新建复杂宏。
          </p>
          <div className="help-links">
            <a href="https://www.qwertykeys.com/pages/fw" target="_blank" rel="noreferrer">
              Neo 官方资料 ↗
            </a>
            <a href="https://zmk.dev/docs/features/studio" target="_blank" rel="noreferrer">
              ZMK Studio 文档 ↗
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

function DeviceHub({ onConnect, onDemo }: { onConnect(): void; onDemo(): void }) {
  const s = useWorkspace();
  const busy = s.operation !== 'idle';
  const devices = Object.values(s.sessions).filter((session) => session.connection === 'device');
  const demos = Object.values(s.sessions).filter((session) => session.connection === 'demo');
  return (
    <div className="device-hub">
      <div className="hub-section-heading">
        <h2>
          我的设备 <span>{devices.length.toString().padStart(2, '0')}</span>
        </h2>
        <span>
          <ShieldCheck size={14} />
          设备直连 · 配置留在本机
        </span>
      </div>
      {devices.length ? (
        <div className="connected-devices">
          {devices.map((session) => (
            <button
              className="connected-card"
              key={session.model}
              onClick={() => s.openDevice(session.model)}
              disabled={busy}
              aria-label={`${session.draft.name} 开始配置`}
            >
              <div className="connected-card-top">
                <span className="connection-badge device">
                  <span className="status-dot" />
                  USB 已连接
                </span>
                {isDirty(session) && <span className="draft-tag">有未保存草稿</span>}
              </div>
              <div className="connected-visual">
                <Keyboard snapshot={session.draft} layerId={session.layerId} miniature />
              </div>
              <div className="connected-card-bottom">
                <div>
                  <h3>{session.draft.name}</h3>
                  <p>
                    {session.draft.keys.length} 键 · {session.draft.layers.length} 层 · 原装 PCB
                  </p>
                </div>
                <span>
                  开始配置 <ArrowRight size={18} />
                </span>
              </div>
            </button>
          ))}
          {devices.length < 2 && (
            <button className="add-device-card" onClick={onConnect} disabled={busy}>
              <Plus size={27} />
              <span>连接另一台键盘</span>
            </button>
          )}
        </div>
      ) : (
        <section className="device-empty">
          <div className="empty-copy">
            <span className="empty-eyebrow">A SPACE FOR YOUR KEYBOARD</span>
            <h2>
              你的键盘，
              <br />
              <span>由你定义。</span>
            </h2>
            <p>
              连接一把键盘，进入专属工作台。
              <br />
              从一个键位开始，调成自己喜欢的样子。
            </p>
            <Button primary onClick={onConnect} disabled={busy}>
              <Plus size={17} />
              连接第一台键盘
            </Button>
          </div>
          <div className="connection-object" aria-hidden="true">
            <div className="connection-key">
              <Usb size={49} strokeWidth={1.2} />
              <span>connect</span>
            </div>
            <span className="connection-caption">USB / READY TO CONNECT</span>
          </div>
          <div className="supported-models">
            <span>支持原装 PCB</span>
            <span>Neo75 Cu</span>
            <span>TOFU PAD</span>
            <span className="supported-browser">Chrome / Edge</span>
          </div>
        </section>
      )}
      <div className="hub-steps">
        <div>
          <span>01</span>
          <div>
            <strong>连接设备</strong>
            <p>USB 数据线，浏览器授权</p>
          </div>
        </div>
        <div>
          <span>02</span>
          <div>
            <strong>进入工作台</strong>
            <p>选择已连接的设备卡片</p>
          </div>
        </div>
        <div>
          <span>03</span>
          <div>
            <strong>定义你的习惯</strong>
            <p>编辑、检查，再保存到键盘</p>
          </div>
        </div>
      </div>
      <div className="demo-entry">
        <div>
          <WandSparkles size={18} />
          <span>想先看看工作台？</span>
        </div>
        <button onClick={onDemo} disabled={busy}>
          体验演示 <ArrowRight size={15} />
        </button>
      </div>
      {demos.length > 0 && (
        <div className="demo-sessions">
          {demos.map((session) => (
            <button key={session.model} onClick={() => s.openDevice(session.model)} disabled={busy}>
              继续 {session.draft.name} 演示 <ArrowRight size={13} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function KeymapPage() {
  const s = useWorkspace();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const actions = useMemo(() => actionsFor(s.draft), [s.draft]);
  const layer = s.draft.layers.find((l) => l.id === s.layerId)!;
  const selected = s.selectedIndex === null ? null : layer.bindings[s.selectedIndex];
  const filtered = actions.filter(
    (a) =>
      (category === '全部' || a.category === category) &&
      `${a.label} ${a.description}`.toLowerCase().includes(query.toLowerCase()),
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
              <span className="subtle-tag">{s.draft.keys.length} KEYS</span>
            </h2>
            <p>点击按键，重新定义它的作用</p>
          </div>
          <Button
            onClick={() => void s.refresh()}
            disabled={s.operation !== 'idle' || s.connection === 'offline'}
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
                onClick={() => s.selectLayer(l.id)}
              >
                <span>{index.toString().padStart(2, '0')}</span>
                {l.name}
              </button>
            ))}
          </div>
        </div>
        <div className="keyboard-stage">
          <div className="stage-label">
            <span>LAYOUT / {s.model === 'neo75cu' ? '75%' : 'NUMPAD'}</span>
            <span>{s.layerId === s.draft.layers[0].id ? '基础层' : '功能层'}</span>
          </div>
          <Keyboard
            snapshot={s.draft}
            baseline={s.baseline}
            layerId={s.layerId}
            selected={s.selectedIndex}
            onSelect={s.selectKey}
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
          <span>
            先选一个键，再从右侧选择功能。<kbd>Ctrl</kbd> + <kbd>Z</kbd> 可以撤销。
          </span>
        </div>
      </section>
      <aside className="panel inspector">
        <div className="panel-heading">
          <div>
            <h2>按键功能</h2>
            <p>{selected ? `当前选择 · ${labelFor(selected, s.draft)}` : '选择一个按键开始编辑'}</p>
          </div>
          <span className="inspector-key">
            {selected ? labelFor(selected, s.draft) : <MousePointer2 size={21} />}
          </span>
        </div>
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
          {categories.map((c) => (
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
              disabled={!selected || s.operation !== 'idle'}
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
        <div className="inspector-note">
          <Info size={14} />
          <span>
            {s.draft.protocol === 'via'
              ? '保留原厂键码，不开放未验证的 ANY 高级功能。'
              : '从原厂固件读取可用行为，未识别的现有绑定会原样保留。'}
          </span>
        </div>
      </aside>
    </div>
  );
}

function MacrosPage() {
  const s = useWorkspace();
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<MacroStep[]>([]);
  const [unknown, setUnknown] = useState(false);
  const bytes = JSON.stringify(s.draft.macros[index] ?? []);
  useEffect(() => {
    const decoded = decodeMacro(JSON.parse(bytes) as number[], s.draft.protocolVersion);
    setUnknown(decoded === null);
    setSteps(decoded ?? []);
  }, [bytes, index, s.model, s.draft.protocolVersion]);
  if (s.draft.protocol === 'zmk')
    return (
      <section className="panel feature-note">
        <div className="feature-icon">
          <Command size={30} />
        </div>
        <h2>使用固件已有的行为</h2>
        <p>
          TOFU PAD 原厂 ZMK Studio 当前不支持在线新建或编辑复杂宏。
          <br />
          已定义的无参数宏行为会出现在“按键设置 → 设备”中；现有绑定会完整保留。
        </p>
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
          <p>编辑完成后应用到草稿，再统一保存到键盘</p>
        </div>
        <span className="capacity">
          {used} / {Math.max(0, s.draft.macroBufferSize - 1)} bytes
        </span>
      </div>
      <div className="macro-layout">
        <div className="macro-slots">
          {s.draft.macros.map((m, i) => (
            <button key={i} className={index === i ? 'active' : ''} onClick={() => setIndex(i)}>
              <Command size={15} />
              <span>宏 {i + 1}</span>
              <small>{m.length ? `${m.length} B` : '空'}</small>
            </button>
          ))}
        </div>
        <div className="macro-editor">
          <div className="section-title">
            <h3>宏 {index + 1}</h3>
            <span className="subtle-tag">M{index}</span>
          </div>
          {unknown && (
            <div className="alert error">
              此宏含有暂不支持的编码，原始字节会保留。编辑并应用将替换此槽位。
            </div>
          )}
          {!steps.length && (
            <div className="macro-empty">
              <Command size={32} />
              <strong>从第一个动作开始</strong>
              <p>添加文本、按键或延时，组成你的操作序列。</p>
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
              disabled={s.operation !== 'idle' || !s.draft.macros.length}
              onClick={() => {
                try {
                  const encoded = encodeMacro(steps, s.draft.protocolVersion);
                  const size = used - s.draft.macros[index].length + encoded.length;
                  if (size >= s.draft.macroBufferSize) throw new Error('宏总长度超出设备容量。');
                  s.editMacro(index, encoded);
                  s.notify('宏已应用到草稿。可以在按键设置中将 M' + index + ' 分配给一个键。');
                } catch (e) {
                  s.report(e);
                }
              }}
            >
              应用到草稿 <Check size={16} />
            </Button>
          </div>
        </div>
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
  const refresh = () => listProfiles().then(setProfiles).catch(s.report);
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section className="panel profiles-panel">
      <div className="panel-heading">
        <div>
          <h2>本地方案库</h2>
          <p>方案与备份保存在此浏览器，可导出文件随身携带</p>
        </div>
        <Button onClick={() => file.current?.click()}>
          <ArrowUpFromLine size={16} />
          导入方案
        </Button>
        <input
          ref={file}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          aria-label="导入 JSON 方案"
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
              .then((p) => saveProfile(p.name, p.snapshot))
              .then(() => {
                void refresh();
                s.notify('方案已导入本地库，尚未写入设备。');
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
                s.notify('当前草稿已保存为本地方案。');
              })
              .catch(s.report);
          }}
        >
          <FolderHeart size={20} />
          <input
            aria-label="方案名称"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="给当前配置起个名字，例如：日常办公"
          />
          <Button type="submit" primary disabled={!name.trim()}>
            保存当前方案
          </Button>
        </form>
      )}
      <div className="profile-list">
        {profiles.length === 0 ? (
          <div className="empty-state">
            <FolderHeart size={36} />
            <h3>把第一套习惯，存下来。</h3>
            <p>手动保存的方案和写入前自动备份都会出现在这里。</p>
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
                    {p.kind === 'backup' ? '自动备份' : p.kind === 'draft' ? '草稿' : '方案'}
                  </span>
                </h3>
                <p>
                  {MODEL_NAMES[p.snapshot.model]} · {new Date(p.createdAt).toLocaleString('zh-CN')}{' '}
                  {p.snapshot.identity.startsWith('DEMO:') ? '· 演示配置' : ''}
                </p>
              </div>
              <div className="profile-actions">
                <Button
                  disabled={s.operation !== 'idle'}
                  onClick={() => {
                    try {
                      s.loadProfile(p.snapshot);
                      s.setPage('keymap');
                    } catch (e) {
                      s.report(e);
                    }
                  }}
                >
                  载入草稿
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
        title="删除这份本地方案？"
        description={deleting?.name ?? ''}
      >
        <p>只删除浏览器中的这份记录，不改变键盘配置。需要保留时可以先导出。</p>
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
            删除方案
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function TesterPage() {
  const [active, setActive] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [events, setEvents] = useState<{ code: string; type: string; time: string }[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reset = () => {
      setHeld([]);
      setActive(false);
    };
    window.addEventListener('blur', reset);
    return () => window.removeEventListener('blur', reset);
  }, []);
  return (
    <section className="panel tester-panel">
      <div className="panel-heading">
        <div>
          <h2>浏览器按键测试</h2>
          <p>测试窗口接收到的按键事件，无需写入键盘配置</p>
        </div>
        <Button
          onClick={() => {
            if (!active) stage.current?.focus();
            setActive(!active);
            setHeld([]);
          }}
          primary
        >
          {active ? '停止测试' : '开始测试'}
        </Button>
      </div>
      <div
        className={`test-stage ${active ? 'listening' : ''}`}
        ref={stage}
        tabIndex={0}
        role="group"
        aria-label="按键测试区域"
        onBlur={() => {
          setActive(false);
          setHeld([]);
        }}
        onKeyDown={(e) => {
          if (!active) return;
          e.preventDefault();
          if (e.code === 'Escape') {
            setActive(false);
            setHeld([]);
            return;
          }
          if (e.repeat) return;
          setHeld((old) => [...new Set([...old, e.code])]);
          setSeen((old) => [...new Set([...old, e.code])]);
          setEvents((old) =>
            [{ code: e.code, type: '按下', time: new Date().toLocaleTimeString() }, ...old].slice(
              0,
              40,
            ),
          );
        }}
        onKeyUp={(e) => {
          if (!active) return;
          e.preventDefault();
          setHeld((old) => old.filter((k) => k !== e.code));
          setEvents((old) =>
            [{ code: e.code, type: '释放', time: new Date().toLocaleTimeString() }, ...old].slice(
              0,
              40,
            ),
          );
        }}
      >
        <div className="test-status">
          <span className={`status-dot ${active ? 'live' : ''}`} />
          {active ? '正在监听 · 按 Esc 退出' : '点击“开始测试”，然后按下键盘'}
        </div>
        <div className="held-keys">
          {held.length ? held.map((k) => <kbd key={k}>{k}</kbd>) : <KeyboardIcon size={56} />}
        </div>
        <div className="test-stats">
          <span>
            <strong>{seen.length}</strong>已测按键
          </span>
          <span>
            <strong>{held.length}</strong>同时按下
          </span>
        </div>
      </div>
      <div className="tester-note">
        <Info size={16} />
        <p>
          此测试不能区分输入来自哪台键盘。Fn、层切换键和系统保留快捷键可能不会产生浏览器事件；这里不用于测量硬件延迟。
        </p>
        <Button
          onClick={() => {
            setSeen([]);
            setEvents([]);
            setHeld([]);
          }}
        >
          清空记录
        </Button>
      </div>
      <div className="event-log">
        {events.slice(0, 12).map((e, i) => (
          <div key={i}>
            <span>{e.time}</span>
            <strong>{e.code}</strong>
            <span>{e.type}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DiagnosticsPage() {
  const s = useWorkspace();
  const environment = {
    secure: window.isSecureContext,
    webHid: 'hid' in navigator,
    webSerial: 'serial' in navigator,
  };
  const entries = [
    { title: '安全访问环境', ok: environment.secure, detail: 'HTTPS / localhost' },
    { title: 'WebHID', ok: environment.webHid, detail: 'Neo75 Cu 的 USB 配置接口' },
    { title: 'Web Serial', ok: environment.webSerial, detail: 'TOFU PAD 的 USB 配置接口' },
    {
      title: '真实设备连接',
      ok: s.connection === 'device',
      detail:
        s.connection === 'demo'
          ? '当前为模拟设备'
          : s.connection === 'device'
            ? `${s.draft.name} · ${s.draft.protocol.toUpperCase()}`
            : '点击右上角连接键盘',
    },
  ];
  const report = () =>
    JSON.stringify(
      {
        app: 'VIAPP',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        environment,
        model: s.model,
        connection: s.connection,
        protocol: s.draft.protocol,
        protocolVersion: s.connection === 'device' ? s.draft.protocolVersion : null,
        keyCount: s.connection === 'device' ? s.draft.keys.length : null,
        logs: s.logs,
      },
      null,
      2,
    );
  return (
    <section className="panel diagnostics-panel">
      <div className="panel-heading">
        <div>
          <h2>连接状态</h2>
          <p>诊断报告不包含键位、宏内容或设备序列号</p>
        </div>
        <Button onClick={() => download('viapp-diagnostics.json', report())}>
          <ArrowDownToLine size={16} />
          导出诊断
        </Button>
      </div>
      <div className="diagnostic-grid">
        {entries.map((entry) => (
          <div className="diagnostic-card" key={entry.title}>
            <div className={`check-icon ${entry.ok ? 'ok' : ''}`}>
              {entry.ok ? <Check size={20} /> : <Info size={20} />}
            </div>
            <div>
              <strong>{entry.title}</strong>
              <p>{entry.detail}</p>
            </div>
            <span>{entry.ok ? '正常' : '待就绪'}</span>
          </div>
        ))}
      </div>
      <div className="compatibility-row">
        <span>
          <Usb size={17} /> USB 有线 <strong>首版配置方式</strong>
        </span>
        <span>
          <Radio size={17} /> 2.4G <strong>待验证</strong>
        </span>
        <span>
          蓝牙 <strong>仅日常输入</strong>
        </span>
      </div>
      <div className="log-heading">
        <h3>
          <Terminal size={16} />
          操作记录
        </h3>
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(report())
              .then(() => s.notify('诊断报告已复制。'))
              .catch((e) => s.report(errorMessage(e)))
          }
        >
          <Copy size={14} />
          复制诊断
        </button>
      </div>
      <div className="diagnostic-log">
        {s.logs.length ? (
          [...s.logs].reverse().map((l, i) => (
            <div className={`log-entry ${l.level}`} key={i}>
              <time>{new Date(l.time).toLocaleTimeString()}</time>
              <span>{l.message}</span>
            </div>
          ))
        ) : (
          <p>尚无操作记录。连接设备后会在这里显示过程。</p>
        )}
      </div>
    </section>
  );
}
