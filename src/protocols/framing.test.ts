import { describe, expect, it } from 'vitest';
import { FrameDecoder, encodeFrame } from './framing';
describe('ZMK framing', () => {
  it('reassembles arbitrary serial chunks and escaped delimiter bytes', () => {
    const data = Uint8Array.from([0, 0xab, 0xac, 0xad, 255, 42]);
    const encoded = encodeFrame(data),
      decoder = new FrameDecoder();
    const frames = Array.from(encoded).flatMap((byte) => decoder.push(Uint8Array.of(byte)));
    expect(frames).toEqual([data]);
  });
  it('handles consecutive frames and ignores bytes before a frame', () => {
    const decoder = new FrameDecoder();
    expect(
      decoder.push(
        Uint8Array.from([4, 5, ...encodeFrame(Uint8Array.of(7)), ...encodeFrame(Uint8Array.of(8))]),
      ),
    ).toEqual([Uint8Array.of(7), Uint8Array.of(8)]);
  });
  it('recovers at a new start and rejects oversized responses', () => {
    const decoder = new FrameDecoder(3);
    expect(decoder.push(Uint8Array.from([0xab, 1, 2, 0xab, 3, 0xad]))).toEqual([Uint8Array.of(3)]);
    expect(() => decoder.push(Uint8Array.from([0xab, 1, 2, 3, 4]))).toThrow('过长');
  });
});
