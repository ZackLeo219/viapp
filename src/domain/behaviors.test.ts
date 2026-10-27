import { describe, expect, it } from 'vitest';
import { previewSnapshot } from './demo';
import { acceptsBinding, referencedLayers, shortcutBinding, validParameter } from './behaviors';
import { actionsFor, labelFor } from './keycodes';

describe('firmware-backed key functions', () => {
  it('encodes shortcuts in each protocol and rejects unrepresentable inputs', () => {
    const via = previewSnapshot('neo75cu'),
      zmk = previewSnapshot('tofu-pad');
    expect(shortcutBinding(via, 6, 3)).toEqual({ type: 'via', code: 0x0306 });
    expect(labelFor(shortcutBinding(via, 6, 3)!, via)).toBe('Ctrl+Shift+C');
    expect(shortcutBinding(zmk, 6, 3)).toEqual({
      type: 'zmk',
      behaviorId: 1,
      param1: 0x03070006,
      param2: 0,
    });
    for (const s of [via, zmk]) {
      expect(shortcutBinding(s, 224, 1)).toBeNull();
      expect(shortcutBinding(s, 6, 16)).toBeNull();
      expect(shortcutBinding(s, NaN, 0)).toBeNull();
    }
  });
  it('exposes only mouse and layer actions accepted by firmware metadata', () => {
    const s = previewSnapshot('tofu-pad');
    expect(actionsFor(s).filter((a) => a.category === '鼠标')).toHaveLength(5);
    s.behaviors.find((b) => b.id === 20)!.metadata![0].param1 = [{ name: 'LBTN', constant: 1 }];
    expect(actionsFor(s).filter((a) => a.category === '鼠标')).toHaveLength(1);
    delete s.behaviors.find((b) => b.id === 20)!.metadata;
    expect(actionsFor(s).filter((a) => a.category === '鼠标')).toHaveLength(0);
  });
  it('validates both dual-role parameters against the same metadata set', () => {
    const s = previewSnapshot('tofu-pad'),
      behavior = s.behaviors.find((b) => b.id === 10)!;
    const b = { type: 'zmk' as const, behaviorId: 10, param1: 1, param2: 0x70004 };
    expect(acceptsBinding(behavior, b, [0, 1])).toBe(true);
    expect(acceptsBinding(behavior, { ...b, param1: 5 }, [0, 1])).toBe(false);
    expect(acceptsBinding(behavior, { ...b, param2: 0x80004 }, [0, 1])).toBe(false);
    expect(referencedLayers(s, b)).toEqual([1]);
    expect(labelFor(b, s)).toBe('A / 层 1');
    expect(validParameter(-1, [{ name: 'range', range: { min: 0, max: 10 } }], [])).toBe(false);
  });
});
