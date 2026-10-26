import type { KeyAction } from './keycodes';

// Some Windows input paths omit right Shift's code and location. Match the
// established tester fallback for key="Shift"; explicit code/location wins.
export function codeForInputEvent(event: Pick<KeyboardEvent, 'code' | 'key' | 'location'>): string {
  if (event.code && event.code !== 'Unidentified' && event.code !== 'Shift') return event.code;
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
    if (event.location === 1) return `${event.key}Left`;
    if (event.location === 2) return `${event.key}Right`;
    if (event.key === 'Shift') return 'ShiftRight';
  }
  return '';
}

const codes: Record<string, number> = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  IntlHash: 50,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  CapsLock: 57,
  PrintScreen: 70,
  ScrollLock: 71,
  Pause: 72,
  Insert: 73,
  Home: 74,
  PageUp: 75,
  Delete: 76,
  End: 77,
  PageDown: 78,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  NumLock: 83,
  NumpadDivide: 84,
  NumpadMultiply: 85,
  NumpadSubtract: 86,
  NumpadAdd: 87,
  NumpadEnter: 88,
  Numpad0: 98,
  NumpadDecimal: 99,
  IntlBackslash: 100,
  ContextMenu: 101,
  NumpadEqual: 103,
  ControlLeft: 224,
  ShiftLeft: 225,
  AltLeft: 226,
  MetaLeft: 227,
  ControlRight: 228,
  ShiftRight: 229,
  AltRight: 230,
  MetaRight: 231,
};
export function actionForInput(code: string, actions: KeyAction[]): KeyAction | undefined {
  let hid = codes[code];
  if (/^Key[A-Z]$/.test(code)) hid = code.charCodeAt(3) - 65 + 4;
  else if (/^Digit[0-9]$/.test(code)) hid = code === 'Digit0' ? 39 : Number(code.slice(5)) + 29;
  else if (/^Numpad[1-9]$/.test(code)) hid = Number(code.slice(6)) + 88;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    const n = Number(code.slice(1));
    hid = n <= 12 ? n + 57 : n + 91;
  }
  return hid === undefined ? undefined : actions.find((a) => a.hid === hid && !a.page);
}
export const isModifier = (code: string) => /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(code);
