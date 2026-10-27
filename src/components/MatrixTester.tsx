import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { readDeviceMatrix, useWorkspace } from '../state/workspace';
import { labelFor } from '../domain/keycodes';

export function MatrixTester({ suspended }: { suspended: boolean }) {
  const snapshot = useWorkspace((s) => s.baseline);
  const [listening, setListening] = useState(true);
  const [held, setHeld] = useState<number[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [error, setError] = useState('');
  const [peak, setPeak] = useState(0);
  const previous = useRef(new Set<number>());
  const stage = useRef<HTMLDivElement>(null);
  const escapeAt = useRef(0);
  const resume = useRef(false);
  const keys = snapshot.keys;
  const minX = Math.min(...keys.map((k) => k.x)),
    minY = Math.min(...keys.map((k) => k.y));
  const width = Math.max(...keys.map((k) => k.x + k.w)) - minX;
  const height = Math.max(...keys.map((k) => k.y + k.h)) - minY;
  const tested = keys.filter((k) => counts[k.index]).length;
  const start = () => {
    setError('');
    setListening(true);
    stage.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    stage.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!listening || suspended) {
      previous.current.clear();
      setHeld([]);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (
          useWorkspace.getState().operation === 'idle' &&
          !document.hidden &&
          document.hasFocus()
        ) {
          const indices = await readDeviceMatrix();
          if (stopped) return;
          if (indices === null) {
            setError('当前连接无法读取物理按键，请使用按键输出测试。');
            setListening(false);
            return;
          }
          const visible = indices.filter((i) => keys.some((k) => k.index === i));
          const changed =
            visible.length !== previous.current.size ||
            visible.some((i) => !previous.current.has(i));
          if (changed) {
            const pressed = visible.filter((i) => !previous.current.has(i));
            if (pressed.length)
              setCounts((old) => {
                const next = { ...old };
                for (const i of pressed) next[i] = (next[i] ?? 0) + 1;
                return next;
              });
            previous.current = new Set(visible);
            setHeld(visible);
            setPeak((old) => Math.max(old, visible.length));
          }
        }
        if (!stopped) timer = setTimeout(poll, 35);
      } catch {
        if (!stopped) {
          setError('读取中断，请重新连接设备。');
          setListening(false);
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      previous.current.clear();
    };
  }, [listening, suspended, keys]);
  useEffect(() => {
    const blur = () => {
      if (listening) resume.current = true;
      setListening(false);
    };
    const focus = () => {
      if (resume.current && !suspended && !document.hidden) {
        resume.current = false;
        setListening(true);
      }
    };
    const visibility = () => (document.hidden ? blur() : focus());
    const key = (e: KeyboardEvent) => {
      if (
        !listening ||
        suspended ||
        (e.target instanceof Element && e.target.closest('input,select,textarea,[role="dialog"]'))
      )
        return;
      e.preventDefault();
      if (e.type === 'keydown' && e.code === 'Escape' && !e.repeat) {
        if (escapeAt.current && e.timeStamp - escapeAt.current < 450) {
          resume.current = false;
          setListening(false);
        }
        escapeAt.current = e.timeStamp;
      }
    };
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
    };
  }, [listening, suspended]);
  return (
    <section className="tester matrix-tester">
      <div className="panel tester-panel">
        <div className="tester-toolbar">
          <div className="tester-coverage">
            <div>
              <strong>
                {tested}
                <span> / {keys.length}</span>
              </strong>
              <span>已测试</span>
            </div>
            <div
              className="tester-progress"
              role="progressbar"
              aria-label="物理按键测试进度"
              aria-valuenow={tested}
              aria-valuemin={0}
              aria-valuemax={keys.length}
            >
              <span style={{ width: `${(tested / keys.length) * 100}%` }} />
            </div>
          </div>
          <div className="tester-controls">
            <button
              className="button"
              onClick={() => {
                resume.current = false;
                listening ? setListening(false) : start();
              }}
            >
              {listening ? <Pause size={15} /> : <Play size={15} />} {listening ? '暂停' : '继续'}
            </button>
            <button
              className="button"
              aria-label="重置物理测试"
              onClick={() => {
                setCounts({});
                setHeld([]);
                setPeak(0);
                previous.current.clear();
              }}
            >
              <RotateCcw size={15} />
              重置
            </button>
          </div>
        </div>
        <div
          ref={stage}
          className={`tester-stage ${listening && !suspended ? 'listening' : ''}`}
          tabIndex={0}
          aria-label="物理按键测试"
          onClick={() => !listening && start()}
        >
          <div className="tester-stage-status">
            <span className={`status-dot ${listening && !suspended ? 'live' : ''}`} />
            {error ||
              (listening && !suspended ? '请按键 · 双按 Esc 暂停' : '已暂停 · 点击键盘继续')}
          </div>
          <svg
            className="tester-keyboard"
            viewBox={`0 0 ${width * 50 + 16} ${height * 50 + 16}`}
            role="img"
            aria-label={`${snapshot.name} 物理测试键盘`}
          >
            {keys.map((k) => {
              const status = held.includes(k.index)
                ? 'held'
                : counts[k.index]
                  ? 'tested'
                  : 'untested';
              const label = labelFor(snapshot.layers[0].bindings[k.index], snapshot)
                .replace('L ', '')
                .replace('R ', '');
              return (
                <g
                  key={k.id}
                  className={`tester-key ${status}`}
                  data-matrix-index={k.index}
                  data-state={status}
                  transform={`translate(${(k.x - minX) * 50 + 8},${(k.y - minY) * 50 + 8})`}
                >
                  <title>
                    {label} · {counts[k.index] ?? 0} 次
                  </title>
                  <rect
                    className="tester-key-base"
                    y={2}
                    width={k.w * 50 - 5}
                    height={k.h * 50 - 5}
                    rx={6}
                  />
                  <rect
                    className="tester-key-face"
                    width={k.w * 50 - 5}
                    height={k.h * 50 - 7}
                    rx={6}
                  />
                  <text
                    className={label.length > 4 ? 'small-label' : ''}
                    x={(k.w * 50 - 5) / 2}
                    y={(k.h * 50 - 5) / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
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
            <span className="binding-note">包含 Fn，按物理位置显示</span>
          </div>
        </div>
      </div>
      <div className="tester-readout">
        <span className="binding-note">仅检测当前键盘</span>
        <div className="tester-metrics">
          <span>
            同时按下 <strong>{held.length}</strong>
          </span>
          <span>
            最多同时 <strong>{peak}</strong>
          </span>
          <span>
            总次数 <strong>{Object.values(counts).reduce((a, b) => a + b, 0)}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}
