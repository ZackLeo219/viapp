export type MacroStep =
  | { type: 'text'; text: string }
  | { type: 'tap' | 'down' | 'up'; key: number }
  | { type: 'delay'; ms: number };
export function encodeMacro(steps: MacroStep[], version: number): number[] {
  const result: number[] = [];
  const held = new Set<number>();
  for (const step of steps) {
    if (step.type === 'text') {
      if (!/^[\x20-\x7e]*$/.test(step.text))
        throw new Error(
          '文本宏仅支持英文、数字和 ASCII 符号。换行请添加 Enter 按键，中文需由输入法完成。',
        );
      result.push(...Array.from(step.text, (c) => c.charCodeAt(0)));
    } else if (step.type === 'delay') {
      if (version < 11) throw new Error('当前 VIA 固件不支持宏延时。');
      if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 9999)
        throw new Error('延时应为 0–9999 毫秒的整数。');
      result.push(1, 4, ...Array.from(String(step.ms), (c) => c.charCodeAt(0)), 124);
    } else {
      if (!Number.isInteger(step.key) || step.key < 4 || step.key > 255)
        throw new Error('宏中的按键必须是基本 HID 按键。');
      if (step.type === 'down') {
        if (held.has(step.key)) throw new Error('同一个键不能连续按下两次，请先释放。');
        held.add(step.key);
      }
      if (step.type === 'up') {
        if (!held.delete(step.key)) throw new Error('释放前需要先按下该键。');
      }
      if (version >= 11) result.push(1);
      result.push(step.type === 'tap' ? 1 : step.type === 'down' ? 2 : 3, step.key);
    }
  }
  if (held.size) throw new Error('每个“按下”都需要对应的“释放”，以免宏执行后按键卡住。');
  return result;
}
export function decodeMacro(bytes: number[], version: number): MacroStep[] | null {
  const steps: MacroStep[] = [];
  let text = '';
  const flush = () => {
    if (text) {
      steps.push({ type: 'text', text });
      text = '';
    }
  };
  for (let i = 0; i < bytes.length; i++) {
    let byte = bytes[i];
    const instruction = version >= 11 ? byte === 1 : byte >= 1 && byte <= 3;
    if (!instruction) {
      if (byte < 32 || byte > 126) return null;
      text += String.fromCharCode(byte);
      continue;
    }
    flush();
    if (version >= 11) byte = bytes[++i];
    if (byte >= 1 && byte <= 3) {
      const key = bytes[++i];
      if (!key || key < 4) return null;
      steps.push({ type: byte === 1 ? 'tap' : byte === 2 ? 'down' : 'up', key });
    } else if (byte === 4 && version >= 11) {
      let value = '';
      while (++i < bytes.length && bytes[i] !== 124) value += String.fromCharCode(bytes[i]);
      if (bytes[i] !== 124 || !/^\d{1,4}$/.test(value)) return null;
      steps.push({ type: 'delay', ms: Number(value) });
    } else return null;
  }
  flush();
  return steps;
}
