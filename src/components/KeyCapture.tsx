import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Keyboard, X } from 'lucide-react';
import { actionForInput, codeForInputEvent, isModifier } from '../domain/keyboard-input';
import type { KeyAction } from '../domain/keycodes';
import './KeyCapture.css';

export function KeyCapture({
  actions,
  onAssign,
  disabled,
  startRequest = null,
}: {
  actions: KeyAction[];
  onAssign(action: KeyAction): void;
  disabled: boolean;
  startRequest?: number | null;
}) {
  const [recording, setRecording] = useState(startRequest !== null && !disabled);
  const [message, setMessage] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const modifier = useRef<string | null>(null);
  const rejected = useRef(false);
  const restoreFocus = useRef(false);
  const lastRequest = useRef(startRequest);
  const stop = (restore = false) => {
    restoreFocus.current = restore;
    setRecording(false);
  };
  useLayoutEffect(() => {
    if (lastRequest.current === startRequest) return;
    lastRequest.current = startRequest;
    restoreFocus.current = false;
    modifier.current = null;
    rejected.current = false;
    setMessage('');
    setRecording(startRequest !== null && !disabled);
  }, [startRequest, disabled]);
  useLayoutEffect(() => {
    if (recording) {
      modifier.current = null;
      rejected.current = false;
      stage.current?.focus({ preventScroll: true });
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus({ preventScroll: true });
    }
  }, [recording, startRequest]);
  useLayoutEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  useEffect(() => {
    const cancel = () => stop();
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
    stop(true);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || disabled) return;
    const code = codeForInputEvent(e);
    if (down) {
      if (isModifier(code)) {
        if (modifier.current && modifier.current !== code) rejected.current = true;
        modifier.current = code;
      } else if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
        rejected.current = true;
        setMessage('组合键请在「快捷键」中设置。');
      } else apply(code);
    } else if (isModifier(code)) {
      if (modifier.current === code && !rejected.current) apply(code);
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
        hidden={recording}
        disabled={disabled}
        onClick={() => {
          setMessage('');
          setRecording(true);
        }}
      >
        <Keyboard size={16} />
        录入按键
      </button>
      <div className="capture-box" hidden={!recording}>
        <div
          ref={stage}
          tabIndex={0}
          role="group"
          aria-label="录入目标按键"
          onKeyDown={(e) => key(e, true)}
          onKeyUp={(e) => key(e, false)}
          onBlur={() => stop()}
        >
          <span className="status-dot live" />
          按下目标键
        </div>
        <button
          aria-label="取消录入"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            stop(true);
          }}
        >
          <X size={15} />
        </button>
      </div>
      {recording && message && <p role="status">{message}</p>}
    </div>
  );
}
