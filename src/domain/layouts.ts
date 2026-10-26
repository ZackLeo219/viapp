import type { PhysicalKey } from './types';

// Matrix addresses transcribed from Qwertykeys' original tri-mode NEO75 definition.
// Source and board identity are documented in THIRD_PARTY_NOTICES.md.
export function neoLayout(options = 0): PhysicalKey[] {
  const result: PhysicalKey[] = [];
  const key = (row: number, col: number, x: number, y: number, w = 1, h = 1) =>
    result.push({ id: `${row},${col}`, index: row * 16 + col, row, col, x, y, w, h });
  key(0, 0, 0, 0);
  for (let i = 1; i <= 12; i++) key(0, i, i + 0.5 + Math.floor((i - 1) / 4) * 0.5, 0);
  key(2, 14, 15, 0);
  for (let i = 0; i <= 12; i++) key(1, i, i, 1.35);
  if (options & 8) {
    key(1, 14, 13, 1.35);
    key(1, 13, 14, 1.35);
  } else key(1, 13, 13, 1.35, 2);
  key(1, 15, 15, 1.35);
  key(2, 0, 0, 2.35, 1.5);
  for (let i = 1; i <= 12; i++) key(2, i, i + 0.5, 2.35);
  if (options & 4) key(5, 8, 13.75, 2.35, 1.25, 2);
  else key(2, 13, 13.5, 2.35, 1.5);
  key(3, 14, 15, 2.35);
  key(3, 0, 0, 3.35, 1.75);
  for (let i = 1; i <= 11; i++) key(3, i, i + 0.75, 3.35);
  if (options & 4) key(3, 12, 12.75, 3.35);
  else key(3, 13, 12.75, 3.35, 2.25);
  key(3, 15, 15, 3.35);
  if (options & 2) {
    key(4, 0, 0, 4.35, 1.25);
    key(4, 1, 1.25, 4.35);
  } else key(4, 0, 0, 4.35, 2.25);
  for (let i = 2; i <= 11; i++) key(4, i, i + 0.25, 4.35);
  key(4, 13, 12.25, 4.35, 1.75);
  key(4, 14, 14, 4.35);
  key(2, 15, 15, 4.35);
  if (options & 1) {
    key(5, 0, 0, 5.35, 1.5);
    key(5, 1, 1.5, 5.35);
    key(5, 2, 2.5, 5.35, 1.5);
    key(5, 5, 4, 5.35, 7);
    key(5, 10, 11, 5.35, 1.5);
  } else {
    key(5, 0, 0, 5.35, 1.25);
    key(5, 1, 1.25, 5.35, 1.25);
    key(5, 2, 2.5, 5.35, 1.25);
    key(5, 5, 3.75, 5.35, 6.25);
    key(5, 9, 10, 5.35, 1.25);
    key(5, 10, 11.25, 5.35, 1.25);
  }
  key(5, 13, 13, 5.35);
  key(5, 14, 14, 5.35);
  key(5, 15, 15, 5.35);
  return result;
}

export function tofuPreviewLayout(): PhysicalKey[] {
  const result: PhysicalKey[] = [];
  const add = (index: number, x: number, y: number, w = 1, h = 1) =>
    result.push({ id: String(index), index, x, y, w, h });
  add(0, 3, 0);
  for (let x = 0; x < 4; x++) add(1 + x, x, 1.25);
  for (let x = 0; x < 3; x++) add(5 + x, x, 2.25);
  for (let x = 0; x < 3; x++) add(8 + x, x, 3.25);
  add(11, 3, 2.25, 1, 2);
  for (let x = 0; x < 3; x++) add(12 + x, x, 4.25);
  add(15, 0, 5.25, 2);
  add(16, 2, 5.25);
  add(17, 3, 4.25, 1, 2);
  return result;
}
