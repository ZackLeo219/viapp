export type TesterLayoutId = 'full' | 'tkl' | 'compact' | 'numpad';
export type KeyLegends = 'win' | 'mac';
export type ShiftSide = 'Left' | 'Right';

// Some Windows input paths deliver Shift with an empty code and location 0.
// That event has no side information: use an explicit local calibration only.
export function testEventCode(
  event: Pick<KeyboardEvent, 'code' | 'key' | 'location'>,
  shiftSide: ShiftSide | null = null,
): string {
  if (event.code && event.code !== 'Unidentified') return event.code;
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
    if (event.location === 1) return `${event.key}Left`;
    if (event.location === 2) return `${event.key}Right`;
    if (event.key === 'Shift') return `Shift${shiftSide ?? 'Unknown'}`;
  }
  return '';
}
export interface TestKey {
  code: string | null;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TesterLayout {
  id: TesterLayoutId;
  name: string;
  width: number;
  height: number;
  keys: TestKey[];
}
const key = (code: string | null, label: string, x: number, y: number, w = 1, h = 1): TestKey => ({
  code,
  label,
  x,
  y,
  w,
  h,
});
const row = (codes: string[], labels: string[], x: number, y: number) =>
  codes.map((code, i) => key(code, labels[i], x + i, y));
const letters = (text: string, x: number, y: number) =>
  row(
    [...text].map((c) => `Key${c}`),
    [...text],
    x,
    y,
  );
const main: TestKey[] = [
  key('Escape', 'Esc', 0, 0),
  ...Array.from({ length: 12 }, (_, i) =>
    key(`F${i + 1}`, `F${i + 1}`, i + 2 + Math.floor(i / 4) * 0.5, 0),
  ),
  key('Backquote', '`', 0, 1.5),
  ...row(
    [...'1234567890'].map((n) => `Digit${n}`),
    [...'1234567890'],
    1,
    1.5,
  ),
  key('Minus', '−', 11, 1.5),
  key('Equal', '=', 12, 1.5),
  key('Backspace', 'Backspace', 13, 1.5, 2),
  key('Tab', 'Tab', 0, 2.5, 1.5),
  ...letters('QWERTYUIOP', 1.5, 2.5),
  key('BracketLeft', '[', 11.5, 2.5),
  key('BracketRight', ']', 12.5, 2.5),
  key('Backslash', '\\', 13.5, 2.5, 1.5),
  key('CapsLock', 'Caps', 0, 3.5, 1.75),
  ...letters('ASDFGHJKL', 1.75, 3.5),
  key('Semicolon', ';', 10.75, 3.5),
  key('Quote', "'", 11.75, 3.5),
  key('Enter', 'Enter', 12.75, 3.5, 2.25),
  key('ShiftLeft', 'Shift', 0, 4.5, 2.25),
  ...letters('ZXCVBNM', 2.25, 4.5),
  key('Comma', ',', 9.25, 4.5),
  key('Period', '.', 10.25, 4.5),
  key('Slash', '/', 11.25, 4.5),
  key('ShiftRight', 'Shift', 12.25, 4.5, 2.75),
  key('ControlLeft', 'Ctrl', 0, 5.5, 1.25),
  key('MetaLeft', 'Win', 1.25, 5.5, 1.25),
  key('AltLeft', 'Alt', 2.5, 5.5, 1.25),
  key('Space', 'Space', 3.75, 5.5, 6.25),
  key('AltRight', 'Alt', 10, 5.5, 1.25),
  key('MetaRight', 'Win', 11.25, 5.5, 1.25),
  key('ContextMenu', 'Menu', 12.5, 5.5, 1.25),
  key('ControlRight', 'Ctrl', 13.75, 5.5, 1.25),
];
const navigation = [
  ...row(['PrintScreen', 'ScrollLock', 'Pause'], ['PrtSc', 'Scroll', 'Pause'], 15.75, 0),
  ...row(['Insert', 'Home', 'PageUp'], ['Ins', 'Home', 'PgUp'], 15.75, 1.5),
  ...row(['Delete', 'End', 'PageDown'], ['Del', 'End', 'PgDn'], 15.75, 2.5),
  key('ArrowUp', '↑', 16.75, 4.5),
  ...row(['ArrowLeft', 'ArrowDown', 'ArrowRight'], ['←', '↓', '→'], 15.75, 5.5),
];
const numpad = [
  ...row(
    ['NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract'],
    ['Num', '/', '×', '−'],
    0,
    0,
  ),
  ...row(['Numpad7', 'Numpad8', 'Numpad9'], ['7', '8', '9'], 0, 1),
  key('NumpadAdd', '+', 3, 1, 1, 2),
  ...row(['Numpad4', 'Numpad5', 'Numpad6'], ['4', '5', '6'], 0, 2),
  ...row(['Numpad1', 'Numpad2', 'Numpad3'], ['1', '2', '3'], 0, 3),
  key('NumpadEnter', 'Enter', 3, 3, 1, 2),
  key('Numpad0', '0', 0, 4, 2),
  key('NumpadDecimal', '.', 2, 4),
];
// A common 75% ANSI layout. Fn is shown, but is not a browser-visible key.
const compact = main
  .filter((k) => !['MetaRight', 'ContextMenu', 'ControlRight'].includes(k.code!))
  .map((k) => {
    if (k.code?.match(/^F\d+$/)) {
      const n = Number(k.code.slice(1));
      return { ...k, x: n + 0.5 + Math.floor((n - 1) / 4) * 0.25 };
    }
    if (k.code === 'ShiftRight') return { ...k, w: 1.75 };
    if (k.code === 'AltRight') return { ...k, w: 1 };
    return k;
  });
compact.push(
  key('Delete', 'Del', 15.25, 0),
  key('Home', 'Home', 15.25, 1.5),
  key('PageUp', 'PgUp', 15.25, 2.5),
  key('PageDown', 'PgDn', 15.25, 3.5),
  key(null, 'Fn', 11, 5.5),
  key('ControlRight', 'Ctrl', 12, 5.5),
  key('ArrowUp', '↑', 14.25, 4.5),
  ...row(['ArrowLeft', 'ArrowDown', 'ArrowRight'], ['←', '↓', '→'], 13.25, 5.5),
);
export const TESTER_LAYOUTS: TesterLayout[] = [
  {
    id: 'full',
    name: '标准 104 键',
    width: 23.25,
    height: 6.5,
    keys: [...main, ...navigation, ...numpad.map((k) => ({ ...k, x: k.x + 19.25, y: k.y + 1.5 }))],
  },
  { id: 'tkl', name: '87 键', width: 18.75, height: 6.5, keys: [...main, ...navigation] },
  { id: 'compact', name: '75%', width: 16.25, height: 6.5, keys: compact },
  { id: 'numpad', name: '数字键盘', width: 4, height: 5, keys: numpad },
];
const labels = new Map(
  TESTER_LAYOUTS.flatMap((l) =>
    l.keys.filter((k) => k.code).map((k) => [k.code!, k.label] as const),
  ),
);
export function testKeyLabel(code: string, legends: KeyLegends): string {
  if (code === 'ShiftUnknown') return 'Shift · 未定位';
  if (legends === 'mac') {
    if (code.startsWith('Meta')) return '⌘';
    if (code.startsWith('Alt')) return '⌥';
  }
  return labels.get(code) ?? code;
}

export interface TesterState {
  listening: boolean;
  held: string[];
  counts: Record<string, number>;
  total: number;
  peak: number;
  recent: string[];
  escapeAt: number | null;
}
export type TesterAction =
  | { type: 'down'; code: string; repeat: boolean; time: number }
  | { type: 'up'; code: string }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'identifyShift'; side: ShiftSide }
  | { type: 'reset' };
export function freshTester(): TesterState {
  return { listening: false, held: [], counts: {}, total: 0, peak: 0, recent: [], escapeAt: null };
}
export function testerReducer(state: TesterState, action: TesterAction): TesterState {
  if (action.type === 'reset') return { ...freshTester(), listening: state.listening };
  if (action.type === 'identifyShift') {
    const code = `Shift${action.side}`;
    const { ShiftUnknown: unknown = 0, ...counts } = state.counts;
    if (!unknown) return state;
    return {
      ...state,
      counts: { ...counts, [code]: (counts[code] ?? 0) + unknown },
      held: [...new Set(state.held.map((c) => (c === 'ShiftUnknown' ? code : c)))],
      recent: state.recent.map((c) => (c === 'ShiftUnknown' ? code : c)),
    };
  }
  if (action.type === 'pause') return { ...state, listening: false, held: [], escapeAt: null };
  if (action.type === 'start') return { ...state, listening: true, held: [], escapeAt: null };
  if (!state.listening) return state;
  if (action.type === 'up') return { ...state, held: state.held.filter((c) => c !== action.code) };
  if (
    action.repeat ||
    state.held.includes(action.code) ||
    !/^[A-Z][A-Za-z0-9]{0,39}$/.test(action.code) ||
    action.code === 'Unidentified'
  )
    return state;
  const held = [...state.held, action.code];
  const escape = action.code === 'Escape' && state.held.length === 0;
  const pause =
    escape &&
    state.escapeAt !== null &&
    action.time >= state.escapeAt &&
    action.time - state.escapeAt <= 450;
  return {
    listening: !pause,
    held: pause ? [] : held,
    counts: { ...state.counts, [action.code]: (state.counts[action.code] ?? 0) + 1 },
    total: state.total + 1,
    peak: Math.max(state.peak, held.length),
    recent: [action.code, ...state.recent].slice(0, 12),
    escapeAt: escape && !pause ? action.time : null,
  };
}
