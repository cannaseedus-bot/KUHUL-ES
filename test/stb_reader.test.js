// test/stb_reader.test.js — JavaScript STB reader tests
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readStb, STB_VERSION } = require('../runtime/src/stb_reader.js');

const STB_MAGIC_UINT32_LE = 0x30544253; // bytes 'STB0' as little-endian uint32

function buildStb(tensors) {
  // Header 32 bytes, descriptor 32 bytes per tensor, data 64-byte aligned.
  const headerSize = 32;
  const descSize = tensors.length * 32;
  const tableEnd = headerSize + descSize;
  const dataOffset = (tableEnd + 63) & ~63;

  const dataBuf = new ArrayBuffer(1024 * 1024); // plenty
  const dataView = new DataView(dataBuf);
  let dataPos = 0;

  const descriptors = tensors.map((t) => {
    const arr = new Float32Array(t.data);
    const start = dataPos;
    for (let i = 0; i < arr.length; i++) {
      dataView.setFloat32(dataPos, arr[i], true);
      dataPos += 4;
    }
    return {
      id: t.id,
      dtype: 0, // float32
      rank: t.shape.length,
      dims: t.shape,
      offset: dataOffset + start,
      size_bytes: arr.length * 4,
    };
  });

  const totalSize = dataOffset + dataPos;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  let off = 0;

  // header: magic bytes 'STB0'
  view.setUint8(off++, 0x53);
  view.setUint8(off++, 0x54);
  view.setUint8(off++, 0x42);
  view.setUint8(off++, 0x30);
  view.setUint8(off++, STB_VERSION);
  view.setUint8(off++, 0); // flags
  view.setUint16(off, tensors.length, true); off += 2;
  view.setUint32(off, 0, true); off += 4; // reserved
  view.setUint32(off, 0, true); off += 4; // reserved
  view.setBigUint64(off, BigInt(dataOffset), true); off += 8;
  view.setBigUint64(off, BigInt(totalSize), true); off += 8;

  // descriptors
  for (const d of descriptors) {
    view.setUint8(off++, d.id);
    view.setUint8(off++, d.dtype);
    view.setUint8(off++, d.rank);
    view.setUint8(off++, 0); // layout
    view.setBigUint64(off, BigInt(d.offset), true); off += 8;
    view.setBigUint64(off, BigInt(d.size_bytes), true); off += 8;
    view.setUint32(off, d.dims[0] || 0, true); off += 4;
    view.setUint32(off, d.dims[1] || 0, true); off += 4;
    view.setUint32(off, d.dims[2] || 0, true); off += 4;
  }

  // copy data
  new Uint8Array(buf, dataOffset, dataPos).set(new Uint8Array(dataBuf, 0, dataPos));

  return buf;
}

describe('STB reader', () => {
  it('reads a minimal float32 STB', () => {
    const buf = buildStb([
      { id: 0, shape: [2, 3], data: [1, 2, 3, 4, 5, 6] },
      { id: 1, shape: [3], data: [7, 8, 9] },
    ]);
    const tensors = readStb(buf);

    assert.equal(Object.keys(tensors).length, 2);
    assert.deepEqual(tensors[0].shape, [2, 3]);
    assert.equal(tensors[0].array[0], 1);
    assert.equal(tensors[0].array[5], 6);
    assert.deepEqual(tensors[1].shape, [3]);
    assert.equal(tensors[1].array[2], 9);
  });

  it('throws on bad magic', () => {
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);
    view.setUint32(0, 0xDEADBEEF, true);
    assert.throws(() => readStb(buf), /Invalid STB magic/);
  });
});
