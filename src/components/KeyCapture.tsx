import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Keyboard, X } from 'lucide-react';
import { actionForInput, isModifier } from '../domain/keyboard-input';
import type { KeyAction } from '../domain/keycodes';
import './KeyCapture.css';

export function KeyCapture({
  actions,
  onAssign,
  disabled,
}: {
  actions: KeyAction[];
  onAssign(action: KeyAction): void;
  disabled: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const modifier = useRef<string | null>(null);
  const rejected = useRef(false);
  useEffect(() => {
    if (recording) {
      modifier.current = null;
      rejected.current = false;
      stage.current?.focus();
    }
  }, [recording]);
  useEffect(() => {
    const cancel = () => setRecording(false);
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, []);
  const apply = (code: string) => {
    const action = actionForInput(code, actions);
    if (!action) {
      setMessage('无法录入此键，请从下方选择。');
      return;
    }
    onAssign(action);
    setRecording(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const key = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || disabled) return;
    if (down) {
      if (isModifier(e.code)) {
        if (modifier.current && modifier.current !== e.code) rejected.current = true;
        modifier.current = e.code;
      } else if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
        rejected.current = true;
        setMessage('这里只录入单个按键。');
      } else apply(e.code);
    } else if (isModifier(e.code)) {
      if (modifier.current === e.code && !rejected.current) apply(e.code);
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        modifier.current = null;
        rejected.current = false;
      }
    }
  };
  return (
    <div className="key-capture">
      <button
        ref={trigger}
        className="button capture-trigger"
        disabled={disabled}
        onClick={() => {
          setMessage('');
          setRecording(true);
        }}
      >
        <Keyboard size={16} />
        录入按键
      </button>
      {recording && (
        <div className="capture-box">
          <div
            ref={stage}
            tabIndex={0}
            role="group"
            aria-label="录入目标按键"
            onKeyDown={(e) => key(e, true)}
            onKeyUp={(e) => key(e, false)}
            onBlur={() => setRecording(false)}
          >
            <span className="status-dot live" />
            按下目标键
          </div>
          <button
            aria-label="取消录入"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              setRecording(false);
              trigger.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {recording && message && <p role="status">{message}</p>}
    </div>
  );
}
