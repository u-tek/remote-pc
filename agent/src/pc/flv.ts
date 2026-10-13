/**
 * Minimal FLV demuxer for ffmpeg's `-f flv` output. FLV gives exact packet boundaries
 * (no waiting for the next start code like raw Annex B) and length-prefixed NAL units,
 * which is what iOS VideoToolbox wants.
 */

export interface VideoTag {
  keyframe: boolean;
  /** 0 = AVC sequence header (decoder config), 1 = NAL units, 2 = end of sequence. */
  packetType: number;
  data: Buffer;
}

export class FlvParser {
  private buf: Buffer = Buffer.alloc(0);
  private headerDone = false;

  push(chunk: Buffer): VideoTag[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: VideoTag[] = [];
    let off = 0;
    if (!this.headerDone) {
      if (this.buf.length < 13) return out;
      if (this.buf.toString('latin1', 0, 3) !== 'FLV') throw new Error('ffmpeg did not produce FLV output');
      const headerSize = this.buf.readUInt32BE(5);
      if (this.buf.length < headerSize + 4) return out;
      off = headerSize + 4;
      this.headerDone = true;
    }
    while (this.buf.length - off >= 11) {
      const type = this.buf[off];
      const size = this.buf.readUIntBE(off + 1, 3);
      const total = 11 + size + 4;
      if (this.buf.length - off < total) break;
      if (type === 9 && size >= 5) {
        const body = this.buf.subarray(off + 11, off + 11 + size);
        const frameType = body[0] >> 4;
        const codec = body[0] & 0x0f;
        if (codec === 7) out.push({ keyframe: frameType === 1, packetType: body[1], data: Buffer.from(body.subarray(5)) });
      }
      off += total;
    }
    this.buf = off === this.buf.length ? Buffer.alloc(0) : this.buf.subarray(off);
    return out;
  }
}

export interface AvcConfig {
  sps: Buffer[];
  pps: Buffer[];
  lengthSize: number;
}

/** Parse an AVCDecoderConfigurationRecord (the FLV sequence header payload). */
export function parseAvcConfig(d: Buffer): AvcConfig {
  if (d.length < 7 || d[0] !== 1) throw new Error('bad AVC decoder configuration record');
  const lengthSize = (d[4] & 0x03) + 1;
  let off = 5;
  const sps: Buffer[] = [];
  const pps: Buffer[] = [];
  const numSps = d[off++] & 0x1f;
  for (let i = 0; i < numSps; i++) {
    const len = d.readUInt16BE(off);
    off += 2;
    sps.push(Buffer.from(d.subarray(off, off + len)));
    off += len;
  }
  const numPps = d[off++];
  for (let i = 0; i < numPps; i++) {
    const len = d.readUInt16BE(off);
    off += 2;
    pps.push(Buffer.from(d.subarray(off, off + len)));
    off += len;
  }
  return { sps, pps, lengthSize };
}

/** Split length-prefixed NAL units. */
export function splitNalus(data: Buffer, lengthSize: number): Buffer[] {
  const out: Buffer[] = [];
  let off = 0;
  while (off + lengthSize <= data.length) {
    const len = data.readUIntBE(off, lengthSize);
    off += lengthSize;
    if (len === 0 || off + len > data.length) break;
    out.push(data.subarray(off, off + len));
    off += len;
  }
  return out;
}

export const MSG_CONFIG = 0;
export const MSG_FRAME = 1;

/** [0, 0, u16 spsLen, sps, u16 ppsLen, pps] */
export function configMessage(sps: Buffer, pps: Buffer): Buffer {
  const head = Buffer.from([MSG_CONFIG, 0]);
  const a = Buffer.alloc(2);
  a.writeUInt16BE(sps.length);
  const b = Buffer.alloc(2);
  b.writeUInt16BE(pps.length);
  return Buffer.concat([head, a, sps, b, pps]);
}

/** [1, flags(bit0 = keyframe), NAL units with 4-byte big-endian lengths] */
export function frameMessage(nalus: Buffer[], keyframe: boolean): Buffer {
  const parts: Buffer[] = [Buffer.from([MSG_FRAME, keyframe ? 1 : 0])];
  for (const n of nalus) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(n.length);
    parts.push(len, n);
  }
  return Buffer.concat(parts);
}
