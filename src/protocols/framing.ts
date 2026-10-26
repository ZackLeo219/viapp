const SOF = 0xab,
  ESC = 0xac,
  EOF = 0xad;
export function encodeFrame(bytes: Uint8Array): Uint8Array {
  const result = [SOF];
  for (const b of bytes) {
    if (b >= SOF && b <= EOF) result.push(ESC);
    result.push(b);
  }
  result.push(EOF);
  return Uint8Array.from(result);
}
export class FrameDecoder {
  private bytes: number[] = [];
  private active = false;
  private escaped = false;
  constructor(private limit = 65536) {}
  push(chunk: Uint8Array): Uint8Array[] {
    const frames: Uint8Array[] = [];
    for (const byte of chunk) {
      if (!this.active) {
        if (byte === SOF) {
          this.active = true;
          this.bytes = [];
          this.escaped = false;
        }
        continue;
      }
      if (this.escaped) {
        this.bytes.push(byte);
        this.escaped = false;
      } else if (byte === SOF) {
        this.bytes = [];
        this.escaped = false;
      } else if (byte === ESC) this.escaped = true;
      else if (byte === EOF) {
        frames.push(Uint8Array.from(this.bytes));
        this.active = false;
        this.bytes = [];
      } else this.bytes.push(byte);
      if (this.bytes.length > this.limit) {
        this.bytes = [];
        this.active = false;
        this.escaped = false;
        throw new Error('设备返回的数据过长，已中止连接。');
      }
    }
    return frames;
  }
}
