import { describe, expect, it } from 'vitest';
import { previewSnapshot } from './demo';
import { exportProfile, parseProfile } from './profiles';
import { neoLayout } from './layouts';
describe('profile integrity', () => {
  it('roundtrips both protocols including unknown original bindings', () => {
    for (const model of ['neo75cu', 'tofu-pad'] as const) {
      const snapshot = previewSnapshot(model);
      expect(parseProfile(exportProfile({ name: '工作', snapshot }))).toEqual({
        name: '工作',
        snapshot,
      });
    }
  });
  it('rejects malformed, oversized and out-of-range input', () => {
    expect(() => parseProfile('{')).toThrow('JSON');
    expect(() => parseProfile(' '.repeat(2_000_001))).toThrow('2 MB');
    const profile = { name: 'bad', snapshot: previewSnapshot('neo75cu') };
    profile.snapshot.layers[0].bindings[0] = { type: 'via', code: -1 };
    expect(() => parseProfile(exportProfile(profile))).toThrow('无效');
  });
  it('rejects duplicate matrix positions and mixed protocols', () => {
    const profile = { name: 'bad', snapshot: previewSnapshot('neo75cu') };
    profile.snapshot.keys[1].index = profile.snapshot.keys[0].index;
    expect(() => parseProfile(exportProfile(profile))).toThrow('无效');
    const p = { name: 'bad', snapshot: previewSnapshot('neo75cu') };
    p.snapshot.layers[0].bindings[0] = { type: 'zmk', behaviorId: 1, param1: 0, param2: 0 };
    expect(() => parseProfile(exportProfile(p))).toThrow('无效');
  });
  it('keeps all stock Neo physical variants within the 6×16 matrix without duplicates', () => {
    for (let options = 0; options < 16; options++) {
      const keys = neoLayout(options);
      expect(new Set(keys.map((k) => k.index)).size).toBe(keys.length);
      expect(keys.every((k) => k.index >= 0 && k.index < 96 && k.x >= 0 && k.x + k.w <= 16)).toBe(
        true,
      );
    }
  });
  it('rejects ambiguous key and behavior identifiers', () => {
    const neo = { name: 'duplicate', snapshot: previewSnapshot('neo75cu') };
    neo.snapshot.keys[1].id = neo.snapshot.keys[0].id;
    expect(() => parseProfile(exportProfile(neo))).toThrow('无效');
    const tofu = { name: 'duplicate', snapshot: previewSnapshot('tofu-pad') };
    tofu.snapshot.behaviors[1].id = tofu.snapshot.behaviors[0].id;
    expect(() => parseProfile(exportProfile(tofu))).toThrow('无效');
  });
  it('reserves the VIA macro sentinel byte before importing any bindings', () => {
    const profile = { name: 'capacity', snapshot: previewSnapshot('neo75cu') };
    profile.snapshot.macros[0] = Array(
      profile.snapshot.macroBufferSize - profile.snapshot.macros.length,
    ).fill(65);
    expect(() => parseProfile(exportProfile(profile))).toThrow('无效');
    profile.snapshot.macros[0].pop();
    expect(parseProfile(exportProfile(profile)).snapshot.macros[0]).toEqual(
      profile.snapshot.macros[0],
    );
  });
});
