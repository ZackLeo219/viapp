import { describe, expect, it } from 'vitest';
import neo65 from '../devices/neo65cu.json';
import {
  definitionLayout,
  optionValues,
  parseDefinitionFile,
  parseViaDefinition,
  setOption,
  validateCompiledDefinition,
  viaModel,
} from './via-definition';
import { layoutBounds } from './layouts';
import { actionsFor, labelFor } from './keycodes';
import { previewSnapshot } from './demo';
import { validateSnapshot } from './profiles';
import { assertCompatible, type DeviceSnapshot } from './types';

const fixture = () => ({
  name: 'Test 6',
  vendorId: '0x1234',
  productId: '0x5678',
  matrix: { rows: 2, cols: 3 },
  layouts: {
    keymap: [
      ['0,0', '0,1', '0,2'],
      ['1,0', '1,1', '1,2'],
    ],
  },
});
function snapshot(): DeviceSnapshot {
  const definition = parseViaDefinition(fixture());
  return {
    ...previewSnapshot('neo75cu'),
    model: 'via-1234-5678',
    name: definition.name,
    identity: '1234:5678',
    viaDefinition: definition,
    keys: definitionLayout(definition),
    layers: [
      {
        id: 0,
        name: '基础层',
        bindings: Array.from({ length: 6 }, () => ({ type: 'via', code: 4 })),
      },
    ],
    macros: [],
    macroBufferSize: 0,
  };
}
describe('definition-driven VIA layouts', () => {
  it('uses Neo65 matrix positions without borrowing the Neo75 top row', () => {
    const d = parseViaDefinition(neo65),
      keys = definitionLayout(d);
    expect(keys).toHaveLength(67);
    expect(keys.find((k) => k.index === 17)).toMatchObject({ row: 1, col: 1, x: 1, y: 0 });
    expect(keys.find((k) => k.index === 77)?.w).toBe(1.75);
    expect(viaModel(d.vendorId, d.productId)).toBe('neo65cu');
    for (let options = 0; options < 16; options++) {
      const alternative = definitionLayout(d, options);
      expect(new Set(alternative.map((k) => k.index)).size).toBe(alternative.length);
      expect(layoutBounds(alternative).width).toBe(16);
    }
  });
  it('aligns external alternatives and includes WKL blockers in their bounds', () => {
    const d = parseViaDefinition({
      ...fixture(),
      layouts: {
        labels: [['Bottom Row', 'WK', 'WKL', 'HHKB']],
        keymap: [
          ['0,0'],
          ['1,0\n\n\n0,0', '1,1\n\n\n0,0'],
          [{ y: 2, x: 5, d: true }, '1,0\n\n\n0,1', '1,1\n\n\n0,1'],
          [{ x: 4, w: 2 }, '1,1\n\n\n0,2'],
        ],
      },
    });
    expect(definitionLayout(d, 1)).toEqual(
      expect.arrayContaining([expect.objectContaining({ index: 4, x: 1, y: 1 })]),
    );
    expect(definitionLayout(d, 1).some((k) => k.index === 3)).toBe(false);
    expect(definitionLayout(d, 2).find((k) => k.index === 4)).toMatchObject({ x: 0, y: 1, w: 2 });
    expect(() => definitionLayout(d, 3)).toThrow('配列选项不存在');
  });
  it('packs multi-choice groups in VIA order and preserves unused firmware bits', () => {
    const options = [
      { label: 'Bottom', choices: ['WK', 'WKL', 'HHKB'] },
      { label: 'Split', choices: ['Off', 'On'] },
    ];
    expect(optionValues(options, 5)).toEqual([2, 1]);
    expect(setOption(options, 0x80000005, 0, 1)).toBe(0x80000003);
    expect(() => setOption(options, 0, 0, 3)).toThrow();
  });
  it('keeps generic keycodes independent of Neo wireless mode bindings', () => {
    const s = snapshot();
    expect(actionsFor(s).some((a) => a.special === 'custom:0')).toBe(false);
    expect(labelFor({ type: 'via', code: 0x7e00 }, s)).toBe('0x7E00');
    expect(labelFor({ type: 'via', code: 0x7c16 }, s)).toBe('Esc / `');
    s.viaDefinition = parseViaDefinition({
      ...fixture(),
      customKeycodes: [
        { name: 'Fan', title: 'Fan speed' },
        { name: 'Reset', title: 'Factory reset' },
      ],
    });
    expect(actionsFor(s).find((a) => a.special === 'custom:0')?.label).toBe('Fan');
    expect(actionsFor(s).some((a) => a.special === 'custom:1')).toBe(false);
  });
  it('validates profiles against their own matrix and protects against edited definitions', () => {
    const original = snapshot();
    expect(validateSnapshot(original)).toEqual(original);
    const edited = structuredClone(original);
    edited.viaDefinition!.matrix.cols = 4;
    expect(() => validateSnapshot(edited)).toThrow();
    expect(() => assertCompatible(original, edited, true)).toThrow('不匹配');
    const wrongKeys = structuredClone(original);
    wrongKeys.keys[0].index = 5;
    expect(() => validateSnapshot(wrongKeys)).toThrow();
  });
  it('rejects unsafe dimensions, duplicate positions and malformed option references', () => {
    expect(() => parseViaDefinition({ ...fixture(), matrix: { rows: 255, cols: 255 } })).toThrow(
      '矩阵',
    );
    expect(() =>
      parseViaDefinition({ ...fixture(), layouts: { keymap: [['0,0', '0,0']] } }),
    ).toThrow('重复');
    expect(() => parseViaDefinition({ ...fixture(), layouts: { keymap: [['2,0']] } })).toThrow(
      '范围',
    );
    expect(() => parseDefinitionFile('{')).toThrow('JSON');
    expect(() => parseDefinitionFile(' '.repeat(2_000_001))).toThrow('2 MB');
    const d = parseViaDefinition(fixture());
    d.keys[0].x = Number.NaN;
    expect(() => validateCompiledDefinition(d)).toThrow();
  });
  it('keeps rotated keys within the drawing bounds', () => {
    const bounds = layoutBounds([
      { id: '0', index: 0, x: 0, y: 0, w: 2, h: 1, rotation: 90, rx: 0, ry: 0 },
    ]);
    expect(bounds.minX).toBeCloseTo(-1);
    expect(bounds.width).toBeCloseTo(1);
    expect(bounds.height).toBeCloseTo(2);
  });
});
