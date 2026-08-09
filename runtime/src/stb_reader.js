// runtime/src/stb_reader.js
//
// JavaScript reader for the SVG-Tensor Binary (.stb) format used by KHΛNARY.
// Works in Node.js (Buffer/ArrayBuffer) and browsers (ArrayBuffer/fetch).
//
// Format spec (mirrors tools/stb.py):
//   Header        32 bytes
//   Tensor table  32 bytes per tensor
//   64-byte aligned raw data region

'use strict';

const STB_MAGIC_BYTES = [0x53, 0x54, 0x42, 0x30]; // 'STB0'
const STB_VERSION = 0x01;

const ENUM_DTYPE = {
  0: { name: 'float32', bytes: 4, typedArray: Float32Array },
  1: { name: 'float16', bytes: 2, typedArray: null }, // not directly supported
  2: { name: 'int8',    bytes: 1, typedArray: Int8Array },
  3: { name: 'int32',   bytes: 4, typedArray: Int32Array },
};

function align64(x) {
  return (x + 63) & ~63;
}

function readStb(buffer) {
  const view = new DataView(buffer);
  let offset = 0;

  // Header: <4sBBHIIQQ
  const magicBytes = [];
  for (let j = 0; j < 4; j++) magicBytes.push(view.getUint8(offset++));
  if (magicBytes.join(',') !== STB_MAGIC_BYTES.join(',')) {
    throw new Error('Invalid STB magic');
  }

  const version = view.getUint8(offset++);
  const flags = view.getUint8(offset++);
  if (version !== STB_VERSION) throw new Error(`Unsupported STB version: ${version}`);
  if (flags !== 0) throw new Error(`Unsupported STB flags: ${flags}`);

  const tensorCount = view.getUint16(offset, true);
  offset += 2;
  offset += 4; // reserved0
  offset += 4; // reserved1
  const dataOffset = Number(view.getBigUint64(offset, true));
  offset += 8;
  const fileSize = Number(view.getBigUint64(offset, true));
  offset += 8;

  if (fileSize !== buffer.byteLength) {
    throw new Error(`STB size mismatch: header=${fileSize}, buffer=${buffer.byteLength}`);
  }

  // Tensor descriptors: <BBBBQQLLL
  const tensors = {};
  for (let i = 0; i < tensorCount; i++) {
    const tid = view.getUint8(offset++);
    const dtypeEnum = view.getUint8(offset++);
    const rank = view.getUint8(offset++);
    const layout = view.getUint8(offset++); // eslint-disable-line no-unused-vars
    const toff = Number(view.getBigUint64(offset, true));
    offset += 8;
    const sizeBytes = Number(view.getBigUint64(offset, true));
    offset += 8;
    const d0 = view.getUint32(offset, true);
    offset += 4;
    const d1 = view.getUint32(offset, true);
    offset += 4;
    const d2 = view.getUint32(offset, true);
    offset += 4;

    const spec = ENUM_DTYPE[dtypeEnum];
    if (!spec) throw new Error(`Unsupported dtype enum: ${dtypeEnum}`);
    if (spec.typedArray === null) throw new Error(`float16 not supported in JS STB reader`);

    const dims = [d0, d1, d2].slice(0, rank);
    const start = toff - dataOffset;
    const end = start + sizeBytes;
    const raw = new Uint8Array(buffer, dataOffset + start, end - start);
    const arr = new spec.typedArray(raw.buffer, raw.byteOffset, sizeBytes / spec.bytes);

    // Reshape if rank <= 3 and dimensions multiply to length
    let reshaped = arr;
    if (rank <= 3) {
      const total = dims.reduce((a, b) => a * b, 1);
      if (total === arr.length) reshaped = { data: arr, shape: dims };
    }

    tensors[tid] = {
      tensor_id: tid,
      dtype: spec.name,
      rank,
      dims,
      array: reshaped.data || arr,
      shape: reshaped.shape || [arr.length],
    };
  }

  return tensors;
}

// Node.js convenience: read file from disk.
async function readStbFile(path) {
  if (typeof window !== 'undefined') {
    const res = await fetch(path);
    const buf = await res.arrayBuffer();
    return readStb(buf);
  }
  const fs = require('fs');
  const buf = fs.readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return readStb(ab);
}

module.exports = { readStb, readStbFile, STB_MAGIC_BYTES, STB_VERSION };
