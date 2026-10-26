import { describe, expect, it } from 'vitest';
import {
  freshTester,
  testerReducer as reduce,
  TESTER_LAYOUTS,
  testKeyLabel,
  testEventCode,
  type TesterState,
} from './tester';

const start = () => reduce(freshTester(), { type: 'start' });
const down = (s: TesterState, code: string, time = 100, repeat = false) =>
  reduce(s, { type: 'down', code, time, repeat });
const up = (s: TesterState, code: string) => reduce(s, { type: 'up', code });

describe('browser keyboard testing', () => {
  it('uses code first, then an explicit modifier location, without guessing an unknown Shift side', () => {
    expect(testEventCode({ code: 'ShiftLeft', key: 'Shift', location: 1 }, 'Right')).toBe(
      'ShiftLeft',
    );
    expect(testEventCode({ code: '', key: 'Shift', location: 2 })).toBe('ShiftRight');
    expect(testEventCode({ code: 'Unidentified', key: 'Control', location: 1 })).toBe(
      'ControlLeft',
    );
    expect(testEventCode({ code: '', key: 'Shift', location: 0 })).toBe('ShiftUnknown');
    expect(testEventCode({ code: '', key: 'Shift', location: 0 }, 'Right')).toBe('ShiftRight');
    expect(testEventCode({ code: '', key: 'Process', location: 0 })).toBe('');
    expect(testEventCode({ code: 'Digit1', key: '!', location: 0 }, 'Right')).toBe('Digit1');
  });
  it('moves unknown Shift results to the chosen side without adding presses or losing the held state', () => {
    const before = down(down(start(), 'ShiftLeft'), 'ShiftUnknown');
    const identified = reduce(before, { type: 'identifyShift', side: 'Right' });
    expect(identified.counts).toEqual({ ShiftLeft: 1, ShiftRight: 1 });
    expect(identified.total).toBe(2);
    expect(identified.held).toEqual(['ShiftLeft', 'ShiftRight']);
    expect(identified.recent).toEqual(['ShiftRight', 'ShiftLeft']);
    expect(up(identified, 'ShiftRight').held).toEqual(['ShiftLeft']);
    const merged = reduce(down(up(identified, 'ShiftRight'), 'ShiftUnknown'), {
      type: 'identifyShift',
      side: 'Right',
    });
    expect(merged.counts.ShiftRight).toBe(2);
    expect(merged.total).toBe(3);
  });
  it('counts distinct presses, ignores repeats, and retains tested keys after release', () => {
    let state = down(start(), 'KeyA');
    state = down(state, 'KeyA', 120, true);
    state = down(state, 'KeyA', 130);
    expect(state.total).toBe(1);
    expect(state.held).toEqual(['KeyA']);
    state = up(state, 'KeyA');
    expect(state.held).toEqual([]);
    expect(state.counts.KeyA).toBe(1);
    expect(down(state, 'KeyA').counts.KeyA).toBe(2);
  });
  it('tracks independent left/right modifiers and numpad keys in chords', () => {
    let state = down(down(down(down(start(), 'ShiftLeft'), 'ShiftRight'), 'Enter'), 'NumpadEnter');
    expect(state.held).toHaveLength(4);
    expect(state.peak).toBe(4);
    state = up(state, 'ShiftLeft');
    expect(state.held).toEqual(['ShiftRight', 'Enter', 'NumpadEnter']);
    expect(state.peak).toBe(4);
  });
  it('pauses without losing results, releases held keys, and ignores inactive events', () => {
    const paused = reduce(down(start(), 'KeyA'), { type: 'pause' });
    expect(paused.held).toEqual([]);
    expect(down(paused, 'KeyB')).toEqual(paused);
    expect(up(paused, 'KeyA')).toEqual(paused);
    const resumed = reduce(paused, { type: 'start' });
    expect(resumed.counts).toEqual({ KeyA: 1 });
    expect(down(resumed, 'KeyA').total).toBe(2);
  });
  it('tests Escape normally and pauses on two distinct quick Escape presses', () => {
    const first = down(start(), 'Escape', 0);
    expect(first.listening).toBe(true);
    expect(down(first, 'Escape', 10, true).listening).toBe(true);
    const second = down(up(first, 'Escape'), 'Escape', 300);
    expect(second.listening).toBe(false);
    expect(second.counts.Escape).toBe(2);
    expect(second.held).toEqual([]);
    expect(down(up(first, 'Escape'), 'Escape', 600).listening).toBe(true);
    expect(down(up(down(up(first, 'Escape'), 'KeyA'), 'KeyA'), 'Escape', 300).listening).toBe(true);
  });
  it('reset removes all counts and a continuing auto-repeat cannot invent a press', () => {
    const reset = reduce(down(start(), 'KeyA'), { type: 'reset' });
    expect(reset).toEqual({ ...freshTester(), listening: true });
    expect(down(reset, 'KeyA', 400, true).total).toBe(0);
  });
  it('ignores unknown codes and bounds recent history', () => {
    let state = start();
    for (const code of ['', 'Unidentified', '__proto__']) state = down(state, code);
    expect(state.total).toBe(0);
    for (let i = 0; i < 100; i++) state = up(down(state, 'KeyA'), 'KeyA');
    expect(state.total).toBe(100);
    expect(state.recent).toHaveLength(12);
  });
});

describe('test layouts', () => {
  it('contains every ANSI key once, including separate numpad Enter and zero', () => {
    expect(TESTER_LAYOUTS.find((l) => l.id === 'full')!.keys).toHaveLength(104);
    expect(TESTER_LAYOUTS.find((l) => l.id === 'tkl')!.keys).toHaveLength(87);
    expect(TESTER_LAYOUTS.find((l) => l.id === 'numpad')!.keys).toHaveLength(17);
    for (const layout of TESTER_LAYOUTS) {
      const codes = layout.keys.filter((k) => k.code).map((k) => k.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const k of layout.keys) {
        expect(k.x + k.w).toBeLessThanOrEqual(layout.width);
        expect(k.y + k.h).toBeLessThanOrEqual(layout.height);
        for (const other of layout.keys) {
          if (k === other) continue;
          expect(
            k.x < other.x + other.w &&
              k.x + k.w > other.x &&
              k.y < other.y + other.h &&
              k.y + k.h > other.y,
          ).toBe(false);
        }
      }
    }
  });
  it('only changes legends for Mac, leaving logical key identities intact', () => {
    expect(testKeyLabel('MetaLeft', 'mac')).toBe('⌘');
    expect(testKeyLabel('AltRight', 'mac')).toBe('⌥');
    expect(testKeyLabel('MetaLeft', 'win')).toBe('Win');
    expect(testKeyLabel('NumpadEnter', 'mac')).toBe('Enter');
  });
});
