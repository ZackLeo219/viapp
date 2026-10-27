import { useEffect, useReducer, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import {
  freshTester,
  testerReducer,
  TESTER_LAYOUTS,
  testKeyLabel,
  type KeyLegends,
  type TesterLayoutId,
} from '../domain/tester';
import { codeForInputEvent } from '../domain/keyboard-input';
import './TesterPage.css';
import { useWorkspace } from '../state/workspace';
import { MatrixTester } from './MatrixTester';

type Locks = Record<'CapsLock' | 'NumLock' | 'ScrollLock', boolean | null>;
const unknownLocks: Locks = { CapsLock: null, NumLock: null, ScrollLock: null };
const unit = 50;
export function TesterPage({ suspended = false }: { suspended?: boolean }) {
  const canReadMatrix = useWorkspace(
    (s) => s.model === 'neo75cu' && s.connection === 'device' && s.baseline.protocolVersion === 12,
  );
  const [physical, setPhysical] = useState(false);
  return (
    <>
      {canReadMatrix && (
        <div className="tester-mode-bar">
          <div className="setting-segments" role="group" aria-label="测试方式">
            <button aria-pressed={!physical} onClick={() => setPhysical(false)}>
              按键输出
            </button>
            <button aria-pressed={physical} onClick={() => setPhysical(true)}>
              物理按键
            </button>
          </div>
        </div>
      )}
      {physical && canReadMatrix ? (
        <MatrixTester suspended={suspended} />
      ) : (
        <BrowserTester suspended={suspended} />
      )}
    </>
  );
}
function BrowserTester({ suspended = false }: { suspended?: boolean }) {
  const [state, dispatch] = useReducer(testerReducer, undefined, freshTester);
  const [layoutId, setLayoutId] = useState<TesterLayoutId>('full');
  const [legends, setLegends] = useState<KeyLegends>('win');
  const [showCounts, setShowCounts] = useState(false);
  const [locks, setLocks] = useState<Locks>(unknownLocks);
  const stage = useRef<HTMLDivElement>(null);
  const resumeOnFocus = useRef(false);
  const layout = TESTER_LAYOUTS.find((l) => l.id === layoutId)!;
  const testable = layout.keys.filter((k) => k.code !== null);
  const tested = testable.filter((k) => state.counts[k.code!] > 0).length;
  const progress = Math.round((tested / testable.length) * 100);
  const start = () => {
    resumeOnFocus.current = false;
    stage.current?.focus({ preventScroll: true });
    dispatch({ type: 'start' });
  };
  useEffect(() => {
    stage.current?.focus({ preventScroll: true });
    dispatch({ type: 'start' });
  }, []);
  useEffect(() => {
    if (suspended) {
      resumeOnFocus.current = false;
      dispatch({ type: 'pause' });
    }
  }, [suspended]);
  useEffect(() => {
    const pause = () => {
      if (state.listening) resumeOnFocus.current = true;
      dispatch({ type: 'pause' });
    };
    const resume = () => {
      if (resumeOnFocus.current && !suspended && !document.hidden) {
        resumeOnFocus.current = false;
        dispatch({ type: 'start' });
      }
    };
    const visibility = () => {
      if (document.hidden) pause();
      else resume();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (!state.listening || suspended) return;
      const code = codeForInputEvent(e);
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) {
        if (e.type === 'keyup') dispatch({ type: 'up', code });
        return;
      }
      e.preventDefault();
      setLocks({
        CapsLock: e.getModifierState('CapsLock'),
        NumLock: e.getModifierState('NumLock'),
        ScrollLock: e.getModifierState('ScrollLock'),
      });
      if (e.type === 'keydown')
        dispatch({ type: 'down', code, repeat: e.repeat, time: e.timeStamp });
      else dispatch({ type: 'up', code });
    };
    window.addEventListener('blur', pause);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', handleKey, true);
    window.addEventListener('keyup', handleKey, true);
    return () => {
      window.removeEventListener('blur', pause);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('keyup', handleKey, true);
    };
  }, [state.listening, suspended]);
  useEffect(() => {
    if (!state.listening) setLocks(unknownLocks);
  }, [state.listening]);
  return (
    <section className="tester">
      <div className="panel tester-panel">
        <div className="tester-toolbar">
          <div className="tester-coverage">
            <div>
              <strong data-testid="tested-count">
                {tested}
                <span> / {testable.length}</span>
              </strong>
              <span>已测试</span>
            </div>
            <div
              className="tester-progress"
              role="progressbar"
              aria-label="按键测试进度"
              aria-valuenow={tested}
              aria-valuemin={0}
              aria-valuemax={testable.length}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="tester-controls">
            <select
              aria-label="测试配列"
              value={layoutId}
              onChange={(e) => {
                setLayoutId(e.target.value as TesterLayoutId);
                start();
              }}
            >
              {TESTER_LAYOUTS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <div className="tester-platform" role="group" aria-label="键帽标识">
              {(['win', 'mac'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={legends === value}
                  onClick={() => {
                    setLegends(value);
                    start();
                  }}
                >
                  {value === 'win' ? 'Win' : 'Mac'}
                </button>
              ))}
            </div>
            <label className="tester-count-toggle">
              <input
                type="checkbox"
                checked={showCounts}
                onChange={(e) => {
                  setShowCounts(e.target.checked);
                  start();
                }}
              />
              次数
            </label>
            <button
              className="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                if (state.listening) {
                  resumeOnFocus.current = false;
                  dispatch({ type: 'pause' });
                } else start();
              }}
            >
              {state.listening ? <Pause size={15} /> : <Play size={15} />}
              {state.listening ? '暂停' : '继续测试'}
            </button>
            <button
              className="button"
              aria-label="重新测试"
              title="重新测试"
              onClick={() => {
                dispatch({ type: 'reset' });
                start();
              }}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>
        <div
          ref={stage}
          className={`tester-stage ${state.listening ? 'listening' : ''}`}
          tabIndex={0}
          role="group"
          aria-label="可视化按键测试"
          aria-describedby="tester-focus-hint"
          onClick={() => {
            if (!state.listening) start();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="tester-stage-status" id="tester-focus-hint">
            <span className={`status-dot ${state.listening ? 'live' : ''}`} />
            {state.listening ? '请按键 · 双按 Esc 暂停' : '已暂停 · 点击键盘继续'}
          </div>
          <div className="tester-scroll" tabIndex={0} role="group" aria-label="测试键盘区域">
            <svg
              className={`tester-keyboard ${layoutId === 'numpad' ? 'numpad' : ''}`}
              viewBox={`0 0 ${layout.width * unit + 16} ${layout.height * unit + 16}`}
              role="img"
              aria-label={`${layout.name}测试键盘`}
            >
              {layout.keys.map((k, index) => {
                const count = k.code ? (state.counts[k.code] ?? 0) : 0;
                const held = k.code ? state.held.includes(k.code) : false;
                const status = held ? 'held' : count ? 'tested' : 'untested';
                const label = k.code ? testKeyLabel(k.code, legends) : k.label;
                const width = k.w * unit - 5,
                  height = k.h * unit - 5;
                return (
                  <g
                    key={k.code ?? `fn-${index}`}
                    className={`tester-key ${status} ${k.code ? '' : 'unavailable'}`}
                    data-test-code={k.code ?? 'Fn'}
                    data-state={status}
                    data-count={count}
                    transform={`translate(${k.x * unit + 8}, ${k.y * unit + 8})`}
                  >
                    <title>
                      {k.code ?? 'Fn'} ·{' '}
                      {k.code
                        ? held
                          ? '按下中'
                          : count
                            ? `已测试 ${count} 次`
                            : '未测试'
                        : '浏览器无法检测'}
                    </title>
                    <rect
                      className="tester-key-base"
                      x={0}
                      y={2}
                      width={width}
                      height={height}
                      rx={6}
                    />
                    <rect className="tester-key-face" width={width} height={height - 2} rx={6} />
                    <text
                      className={label.length > 4 ? 'small-label' : ''}
                      x={width / 2}
                      y={height / 2 - 1}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {label}
                    </text>
                    {showCounts && count > 0 && (
                      <text
                        className="tester-key-count"
                        x={width - 6}
                        y={height - 7}
                        textAnchor="end"
                      >
                        {count}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="tester-board-footer">
            <div className="tester-legend">
              <span>
                <i />
                未测试
              </span>
              <span>
                <i className="tested" />
                已测试
              </span>
              <span>
                <i className="held" />
                按下中
              </span>
            </div>
            <div className="tester-locks" aria-label="锁定状态">
              {(Object.keys(locks) as (keyof Locks)[]).map((code) => (
                <span
                  key={code}
                  className={locks[code] ? 'on' : ''}
                  title={`${code}：${locks[code] === null ? '未知' : locks[code] ? '开启' : '关闭'}`}
                >
                  <i />
                  {code.replace('Lock', '')}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="tester-readout">
        <div className="tester-current">
          <span>按下中</span>
          <div className="tester-held" data-testid="held-keys">
            {state.held.length ? (
              state.held.map((code) => (
                <kbd key={code} title={code}>
                  {testKeyLabel(code, legends)}
                </kbd>
              ))
            ) : (
              <span className="tester-placeholder">—</span>
            )}
          </div>
        </div>
        <div className="tester-metrics">
          <span>
            同时按下 <strong data-testid="held-count">{state.held.length}</strong>
          </span>
          <span>
            最多同时 <strong data-testid="peak-count">{state.peak}</strong>
          </span>
          <span>
            总次数 <strong data-testid="press-count">{state.total}</strong>
          </span>
        </div>
      </div>
      <div className="tester-recent">
        <span>最近按键</span>
        <div>
          {state.recent.length ? (
            state.recent.map((code, i) => (
              <kbd key={`${state.total - i}-${code}`} title={code}>
                {testKeyLabel(code, legends)}
              </kbd>
            ))
          ) : (
            <span className="tester-placeholder">—</span>
          )}
        </div>
      </div>
      <details className="tester-help">
        <summary>测试说明</summary>
        <p>
          按键按输出键值显示，不区分输入设备。Fn
          和部分系统快捷键无法检测；切换窗口会暂停测试。此页不用于测量硬件延迟。
        </p>
      </details>
    </section>
  );
}
