import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { buildArgs, outputSize, pipelinesFor, QUALITIES } from '../src/pc/ffmpeg.js';
import { configMessage, FlvParser, frameMessage, MSG_CONFIG, MSG_FRAME, parseAvcConfig, splitNalus } from '../src/pc/flv.js';
import { keyCodes } from '../src/pc/keys.js';
import { startTestAgent, type TestAgent } from './helpers.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('stream building blocks', () => {
  it('keeps even output sizes inside the quality limit', () => {
    assert.deepEqual(outputSize(2560, 1440, 1600), { width: 1600, height: 900 });
    assert.deepEqual(outputSize(1001, 2001, 1920), { width: 960, height: 1920 });
    assert.deepEqual(outputSize(800, 600, 1600), { width: 800, height: 600 });
  });

  it('builds a GPU pipeline for ddagrab region capture', () => {
    const args = buildArgs(
      { encoder: 'h264_nvenc', gpu: true },
      { kind: 'ddagrab', output: 1, x: 100, y: 50, width: 640, height: 1300, full: false },
      QUALITIES.balanced,
      { width: 640, height: 1300 },
    );
    const joined = args.join(' ');
    assert.match(joined, /-i ddagrab=output_idx=1:framerate=60:draw_mouse=1:video_size=640x1300:offset_x=100:offset_y=50/);
    assert.match(joined, /-vf scale_d3d11=width=640:height=1300:format=nv12/);
    assert.match(joined, /-c:v h264_nvenc .*-tune ull/);
    assert.match(joined, /-f flv .*pipe:1$/);
  });

  it('orders pipelines GPU first and only offers scale_d3d11 when available', () => {
    const probe = { encoders: ['h264_nvenc', 'h264_qsv', 'libx264'], ddagrab: true, scaleD3d11: true };
    assert.deepEqual(pipelinesFor(probe, 'ddagrab'), [
      { encoder: 'h264_nvenc', gpu: true },
      { encoder: 'h264_nvenc', gpu: false },
      { encoder: 'h264_qsv', gpu: false },
      { encoder: 'libx264', gpu: false },
    ]);
    assert.equal(pipelinesFor({ ...probe, scaleD3d11: false }, 'ddagrab')[0].gpu, false);
    assert.equal(pipelinesFor(probe, 'gdigrab').some((p) => p.gpu), false);
  });

  it('maps key names to virtual-key codes', () => {
    assert.deepEqual(keyCodes(['ctrl', 'shift', 'esc']), [0x11, 0x10, 0x1b]);
    assert.deepEqual(keyCodes(['win', 'd']), [0x5b, 0x44]);
    assert.deepEqual(keyCodes(['alt', 'f4']), [0x12, 0x73]);
    assert.throws(() => keyCodes(['hyper']), /Unknown key/);
  });

  it('round-trips frame messages', () => {
    const nalus = [Buffer.from([0x65, 1, 2, 3]), Buffer.from([0x06, 9])];
    const msg = frameMessage(nalus, true);
    assert.equal(msg[0], MSG_FRAME);
    assert.equal(msg[1], 1);
    assert.deepEqual(splitNalus(msg.subarray(2), 4), nalus);
    const cfg = configMessage(Buffer.from([0x67, 1]), Buffer.from([0x68, 2]));
    assert.equal(cfg[0], MSG_CONFIG);
    assert.equal(cfg.readUInt16BE(2), 2);
  });
});

describe('live stream over the WebSocket (real ffmpeg, synthetic screen)', { skip: !hasFfmpeg && 'ffmpeg not installed' }, () => {
  let t: TestAgent;

  before(async () => {
    t = await startTestAgent({ testStream: true });
  });
  after(() => t.close());

  it('streams a decodable H.264 video to the phone', async () => {
    const ws = new WebSocket(`${t.base.replace('http', 'ws')}/api/stream?quality=low`, { headers: { authorization: `Bearer ${t.token}` } });
    const texts: Array<Record<string, unknown>> = [];
    const frames: Array<{ keyframe: boolean; nalus: Buffer[] }> = [];
    let sps: Buffer | undefined;
    let pps: Buffer | undefined;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out; messages: ${JSON.stringify(texts)}`)), 25_000);
      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          texts.push(JSON.parse(data.toString()));
          if (texts.at(-1)?.type === 'error') reject(new Error(String(texts.at(-1)?.message)));
          return;
        }
        const buf = data as Buffer;
        if (buf[0] === MSG_CONFIG) {
          const spsLen = buf.readUInt16BE(2);
          sps = buf.subarray(4, 4 + spsLen);
          pps = buf.subarray(6 + spsLen, 6 + spsLen + buf.readUInt16BE(4 + spsLen));
        } else if (buf[0] === MSG_FRAME) {
          frames.push({ keyframe: buf[1] === 1, nalus: splitNalus(buf.subarray(2), 4) });
          if (frames.length === 45) {
            ws.send(JSON.stringify({ t: 'click', x: 0.5, y: 0.5 }));
            ws.send('not json');
            clearTimeout(timer);
            resolve();
          }
        }
      });
      ws.on('error', reject);
    });
    ws.close();

    const meta = texts.find((m) => m.type === 'meta');
    assert.ok(meta, 'meta message');
    assert.equal(meta!.width, 1280);
    assert.equal(meta!.height, 720);
    assert.equal(meta!.encoder, 'libx264');
    assert.ok(sps && pps, 'decoder config arrived');
    assert.equal(sps![0] & 0x1f, 7, 'SPS NAL');
    assert.equal(pps![0] & 0x1f, 8, 'PPS NAL');
    assert.equal(frames[0].keyframe, true, 'stream starts with a keyframe');
    assert.ok(frames[0].nalus.some((n) => (n[0] & 0x1f) === 5), 'first frame has an IDR slice');

    // Rebuild Annex B exactly as the phone sees it and make ffmpeg decode every frame.
    const start = Buffer.from([0, 0, 0, 1]);
    const annexB = Buffer.concat([start, sps!, start, pps!, ...frames.flatMap((f) => f.nalus.flatMap((n) => [start, n]))]);
    const file = path.join(t.dir, 'received.h264');
    writeFileSync(file, annexB);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', file]);
    assert.equal(probe.status, 0, probe.stderr.toString());
    const info = JSON.parse(probe.stdout.toString()).streams[0];
    assert.equal(info.width, 1280);
    assert.equal(info.height, 720);
    assert.equal(Number(info.nb_read_frames), 45);
    const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
    assert.equal(decode.status, 0);
    assert.equal(decode.stderr.toString().trim(), '', 'decodes without errors');
  });

  it('rejects stream connections without the token', async () => {
    const ws = new WebSocket(`${t.base.replace('http', 'ws')}/api/stream`);
    const err = await new Promise<Error>((resolve) => ws.on('error', resolve));
    assert.match(err.message, /401/);
  });

  it('parses an AVC decoder configuration record', () => {
    const record = Buffer.from([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 3, 0x67, 0x64, 0x00, 1, 0, 2, 0x68, 0xee]);
    const cfg = parseAvcConfig(record);
    assert.equal(cfg.lengthSize, 4);
    assert.deepEqual(cfg.sps[0], Buffer.from([0x67, 0x64, 0x00]));
    assert.deepEqual(cfg.pps[0], Buffer.from([0x68, 0xee]));
    const parser = new FlvParser();
    assert.throws(() => parser.push(Buffer.from('NOPE-not-flv-at-all')), /FLV/);
  });
});
