import { describe, expect, it } from 'vitest';
import { encodeMacro, decodeMacro } from './macros';
describe('macro encoding', () => {
  it('encodes modern key combinations and delays without leaking held modifiers', () => {
    const steps = [
      { type: 'down', key: 224 },
      { type: 'tap', key: 6 },
      { type: 'up', key: 224 },
      { type: 'delay', ms: 125 },
      { type: 'text', text: 'OK' },
    ] as const;
    const bytes = encodeMacro([...steps], 12);
    expect(bytes).toEqual([1, 2, 224, 1, 1, 6, 1, 3, 224, 1, 4, 49, 50, 53, 124, 79, 75]);
    expect(decodeMacro(bytes, 12)).toEqual(steps);
  });
  it('handles the older protocol with a different action format', () => {
    expect(encodeMacro([{ type: 'tap', key: 40 }], 10)).toEqual([1, 40]);
    expect(() => encodeMacro([{ type: 'delay', ms: 100 }], 10)).toThrow('不支持');
  });
  it('rejects Unicode, embedded control bytes and unbalanced keys', () => {
    expect(() => encodeMacro([{ type: 'text', text: '中文' }], 12)).toThrow('ASCII');
    expect(() => encodeMacro([{ type: 'text', text: '\u0001A' }], 12)).toThrow('ASCII');
    expect(() => encodeMacro([{ type: 'down', key: 224 }], 12)).toThrow('释放');
    expect(() => encodeMacro([{ type: 'up', key: 224 }], 12)).toThrow('先按下');
    expect(decodeMacro([1, 4, 49], 12)).toBeNull();
  });
});
