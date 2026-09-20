// test/cli_kxml.test.js — verify kuhul-es kxml command
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLI = path.join(__dirname, '..', 'bin', 'kuhul-es.js');

function buildStbFile(filepath, tensors) {
  const headerSize = 32;
  const descSize = tensors.length * 32;
  const tableEnd = headerSize + descSize;
  const dataOffset = (tableEnd + 63) & ~63;

  const dataBuf = Buffer.alloc(1024 * 1024);
  let dataPos = 0;
  const descriptors = tensors.map((t) => {
    const arr = new Float32Array(t.data);
    const start = dataPos;
    for (let i = 0; i < arr.length; i++) {
      dataBuf.writeFloatLE(arr[i], dataPos);
      dataPos += 4;
    }
    return {
      id: t.id,
      dtype: 0,
      rank: t.shape.length,
      dims: t.shape,
      offset: dataOffset + start,
      size_bytes: arr.length * 4,
    };
  });

  const totalSize = dataOffset + dataPos;
  const buf = Buffer.alloc(totalSize);
  let off = 0;

  // header: magic bytes 'STB0'
  buf.writeUInt8(0x53, off++);
  buf.writeUInt8(0x54, off++);
  buf.writeUInt8(0x42, off++);
  buf.writeUInt8(0x30, off++);
  buf.writeUInt8(0x01, off++); // version
  buf.writeUInt8(0, off++); // flags
  buf.writeUInt16LE(tensors.length, off); off += 2;
  buf.writeUInt32LE(0, off); off += 4;
  buf.writeUInt32LE(0, off); off += 4;
  buf.writeBigUInt64LE(BigInt(dataOffset), off); off += 8;
  buf.writeBigUInt64LE(BigInt(totalSize), off); off += 8;

  for (const d of descriptors) {
    buf.writeUInt8(d.id, off++);
    buf.writeUInt8(d.dtype, off++);
    buf.writeUInt8(d.rank, off++);
    buf.writeUInt8(0, off++);
    buf.writeBigUInt64LE(BigInt(d.offset), off); off += 8;
    buf.writeBigUInt64LE(BigInt(d.size_bytes), off); off += 8;
    buf.writeUInt32LE(d.dims[0] || 0, off); off += 4;
    buf.writeUInt32LE(d.dims[1] || 0, off); off += 4;
    buf.writeUInt32LE(d.dims[2] || 0, off); off += 4;
  }

  dataBuf.copy(buf, dataOffset, 0, dataPos);
  fs.writeFileSync(filepath, buf);
}

describe('CLI kxml command', () => {
  it('runs a synthetic KXML model forward pass', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuhul-kxml-'));
    const stbPath = path.join(tmpDir, 'tiny.stb');
    const manifestPath = path.join(tmpDir, 'tiny.stb.json');

    buildStbFile(stbPath, [
      { id: 0, shape: [2, 3], data: [1, 2, 3, 4, 5, 6] },
      { id: 1, shape: [3, 2], data: [1, 0, 0, 1, 1, 1] },
      { id: 2, shape: [2], data: [0.5, 0.5] },
    ]);

    fs.writeFileSync(manifestPath, JSON.stringify({
      name: 'tiny',
      format: 'khanary-model-stb/v1',
      config: { arch: 'tiny', n_layer: 1, n_embd: 2, n_head: 1, n_ctx: 4, vocab: 2, ln_eps: 1e-5 },
      tensors: {
        wte: { id: 0, dims: [2, 3] },
        B: { id: 1, dims: [3, 2] },
        bias: { id: 2, dims: [2] },
      },
      forward_graph: [
        { step: 'embed', glyph: 'G_EMBED', reads: { tokens: '<input>', wte: { name: 'wte', id: 0 }, wpe: { name: 'wte', id: 0 } } },
        { step: 'proj', glyph: 'G_MATMUL', reads: { B: { name: 'B', id: 1 } }, bias: 'bias' },
      ],
    }, null, 2));

    const r = spawnSync(process.execPath, [CLI, 'kxml', '--stb', stbPath, '--manifest', manifestPath, '--run', '--kast-out', path.join(tmpDir, 'kast.json')], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(r.status, 0, `CLI failed: ${r.stderr}`);
    assert.match(r.stdout, /forward output shape/);
    assert.match(r.stdout, /KAST trace written/);
    const kast = JSON.parse(fs.readFileSync(path.join(tmpDir, 'kast.json'), 'utf8'));
    assert.equal(kast.protocol, 'kfold/1');
    const allNodes = kast.folds.flatMap(f => f.nodes);
    assert.ok(allNodes.some(n => n.glyph === 'G_EMBED'));
    assert.ok(allNodes.some(n => n.glyph === 'G_MATMUL'));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
