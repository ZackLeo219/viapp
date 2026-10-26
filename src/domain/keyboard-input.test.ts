import { describe, expect, it } from 'vitest';
import { KEY_ACTIONS, actionsFor, bindingFor } from './keycodes';
import { actionForInput, isModifier } from './keyboard-input';
import { previewSnapshot } from './demo';

describe('direct key capture', () => {
  it('keeps numpad keys and left/right modifiers distinct', () => {
    expect(actionForInput('Enter', KEY_ACTIONS)?.hid).toBe(40);
    expect(actionForInput('NumpadEnter', KEY_ACTIONS)?.hid).toBe(88);
    expect(actionForInput('Digit0', KEY_ACTIONS)?.hid).toBe(39);
    expect(actionForInput('Numpad0', KEY_ACTIONS)?.hid).toBe(98);
    expect(actionForInput('ShiftRight', KEY_ACTIONS)?.hid).toBe(229);
    expect(actionForInput('ShiftLeft', KEY_ACTIONS)?.hid).toBe(225);
    expect(actionForInput('F24', KEY_ACTIONS)?.hid).toBe(115);
    expect(isModifier('ShiftLeft')).toBe(true);
    expect(isModifier('CapsLock')).toBe(false);
  });
  it('only offers actions exposed by the current firmware and uses its binding format', () => {
    expect(actionForInput('KeyA', [])).toBeUndefined();
    for (const code of ['Unidentified', 'Fn', 'F25'])
      expect(actionForInput(code, KEY_ACTIONS)).toBeUndefined();
    for (const model of ['neo75cu', 'tofu-pad'] as const) {
      const snapshot = previewSnapshot(model);
      const action = actionForInput('KeyA', actionsFor(snapshot))!;
      expect(bindingFor(action, snapshot)).toMatchObject(
        model === 'neo75cu' ? { type: 'via', code: 4 } : { type: 'zmk', param1: 0x70004 },
      );
    }
  });
});
