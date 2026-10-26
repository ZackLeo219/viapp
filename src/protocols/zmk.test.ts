import { describe, expect, it } from 'vitest';
import { describeBehavior, validParameter } from './zmk';

describe('original TOFU PAD firmware metadata', () => {
  it('accepts zero for omitted parameters and rejects nonzero data', () => {
    expect(validParameter(0, [], [0, 1])).toBe(true);
    expect(validParameter(1, [], [0, 1])).toBe(false);
    const hid = [{ name: 'Key', hidUsage: { keyboardMax: 255, consumerMax: 4095 } }];
    expect(validParameter(0x70004, hid, [0, 1])).toBe(true);
    expect(validParameter(0x70100, hid, [0, 1])).toBe(false);
    expect(validParameter(0x80004, hid, [0, 1])).toBe(false);
  });
  it('recognizes manufacturer behavior names instead of assuming upstream names', () => {
    for (const [displayName, kind] of [
      ['Layer Momentary', 'momentary'],
      ['Layer Toggle', 'toggle'],
      ['_Trans', 'transparent'],
      ['Key(None)', 'none'],
    ]) {
      expect(describeBehavior({ id: 7, displayName, metadata: [] }).kind).toBe(kind);
    }
    expect(validParameter(2, [{ name: 'Layer', layerId: {} }], [0, 1])).toBe(false);
    expect(validParameter(1, [{ name: 'Layer', layerId: {} }], [0, 1])).toBe(true);
  });
});
