import { useState } from 'react';
import { Check, Keyboard as KeyboardIcon } from 'lucide-react';
import { KEY_ACTIONS, labelFor } from '../domain/keycodes';
import { actionForInput, codeForInputEvent, isModifier } from '../domain/keyboard-input';
import { acceptsBinding, advancedKind, behaviorTitle, shortcutBinding } from '../domain/behaviors';
import type { Binding, DeviceSnapshot } from '../domain/types';
import './DeviceSettings.css';

const keys = KEY_ACTIONS.filter((a) => a.hid !== undefined && !a.page && a.hid < 224);
function KeyChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}) {
  return (
    <label className="binding-field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {keys.map((a) => (
          <option key={a.id} value={a.hid}>
            {a.label}
          </option>
        ))}
      </select>
    </label>
  );
}
interface Props {
  snapshot: DeviceSnapshot;
  selected: Binding;
  disabled: boolean;
  onApply(binding: Binding): void;
}
export function ShortcutEditor({ snapshot, selected, disabled, onApply }: Props) {
  const initialValue = selected.type === 'via' ? selected.code & 255 : selected.param1 & 65535;
  const [key, setKey] = useState(keys.some((a) => a.hid === initialValue) ? initialValue : 6);
  const [mods, setMods] = useState(
    selected.type === 'via'
      ? selected.code <= 0xfff
        ? selected.code >>> 8
        : 0
      : (selected.param1 >>> 24) & 15,
  );
  const [recording, setRecording] = useState(false);
  const binding = shortcutBinding(snapshot, key, mods);
  return (
    <fieldset className="binding-builder" disabled={disabled}>
      <legend className="visually-hidden">快捷键设置</legend>
      <div className="binding-preview" aria-live="polite">
        <kbd>{binding ? labelFor(binding, snapshot) : '选择快捷键'}</kbd>
      </div>
      <div className="modifier-choices" role="group" aria-label="修饰键">
        {['Ctrl', 'Shift', 'Alt', 'Win'].map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={!!(mods & (1 << i))}
            onClick={() => setMods(mods ^ (1 << i))}
          >
            {label}
          </button>
        ))}
      </div>
      <KeyChoice label="目标按键" value={key} onChange={setKey} />
      <button
        type="button"
        className={`button shortcut-capture ${recording ? 'recording' : ''}`}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat) return;
          const code = codeForInputEvent(e);
          if (isModifier(code)) return;
          const action = actionForInput(code, keys);
          if (action?.hid !== undefined) {
            setKey(action.hid);
            setMods(
              Number(e.ctrlKey) |
                (Number(e.shiftKey) << 1) |
                (Number(e.altKey) << 2) |
                (Number(e.metaKey) << 3),
            );
            setRecording(false);
          }
        }}
      >
        <KeyboardIcon size={15} />
        {recording ? '按下快捷键…' : '录入快捷键'}
      </button>
      <button
        type="button"
        className="button primary binding-apply"
        disabled={!binding || disabled}
        onClick={() => binding && onApply(binding)}
      >
        <Check size={15} />
        应用到按键
      </button>
      {snapshot.protocol === 'via' && (
        <p className="binding-note">原厂固件在无线模式下对组合键支持有限。</p>
      )}
    </fieldset>
  );
}
export function DualRoleEditor({ snapshot, selected, disabled, onApply }: Props) {
  const choices = snapshot.behaviors.filter((b) =>
    ['layer-tap', 'mod-tap'].includes(advancedKind(b) ?? ''),
  );
  const existing =
    selected.type === 'zmk' ? choices.find((b) => b.id === selected.behaviorId) : undefined;
  const [behaviorId, setBehaviorId] = useState(existing?.id ?? choices[0]?.id);
  const [tap, setTap] = useState(
    existing && selected.type === 'zmk' ? selected.param2 & 65535 : 44,
  );
  const [hold, setHold] = useState(
    existing && selected.type === 'zmk'
      ? selected.param1
      : advancedKind(choices[0]) === 'layer-tap'
        ? snapshot.layers.at(-1)!.id
        : 0x700e0,
  );
  const behavior = choices.find((b) => b.id === behaviorId);
  if (!behavior) return null;
  const layerTap = advancedKind(behavior) === 'layer-tap';
  const binding: Binding = {
    type: 'zmk',
    behaviorId: behavior.id,
    param1: hold,
    param2: 0x70000 | tap,
  };
  const valid = acceptsBinding(
    behavior,
    binding,
    snapshot.layers.map((l) => l.id),
  );
  return (
    <fieldset className="binding-builder" disabled={disabled}>
      <legend className="visually-hidden">双功能设置</legend>
      <div className="binding-preview" aria-live="polite">
        <kbd>{valid ? labelFor(binding, snapshot) : '选择功能'}</kbd>
      </div>
      <label className="binding-field">
        <span>行为</span>
        <select
          aria-label="双功能行为"
          value={behavior.id}
          onChange={(e) => {
            const next = choices.find((b) => b.id === Number(e.target.value))!;
            setBehaviorId(next.id);
            if (advancedKind(next) !== advancedKind(behavior))
              setHold(advancedKind(next) === 'layer-tap' ? snapshot.layers.at(-1)!.id : 0x700e0);
          }}
        >
          {choices.map((b) => (
            <option key={b.id} value={b.id}>
              {behaviorTitle(b)}
            </option>
          ))}
        </select>
      </label>
      <KeyChoice label="轻点" value={tap} onChange={setTap} />
      <label className="binding-field">
        <span>长按</span>
        <select aria-label="长按" value={hold} onChange={(e) => setHold(Number(e.target.value))}>
          {layerTap
            ? snapshot.layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))
            : KEY_ACTIONS.filter((a) => a.category === '修饰键').map((a) => (
                <option key={a.id} value={0x70000 | a.hid!}>
                  {a.label}
                </option>
              ))}
        </select>
      </label>
      <button
        type="button"
        className="button primary binding-apply"
        disabled={!valid || disabled}
        onClick={() => valid && onApply(binding)}
      >
        <Check size={15} />
        应用到按键
      </button>
      <p className="binding-note">轻点与长按的判定时间由原厂固件决定。</p>
    </fieldset>
  );
}
