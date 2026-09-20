'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compress, decompress, compressJSON, decompressJSON } = require('../runtime/src/scxq2.js');

describe('scxq2 compression', () => {
  it('round-trips a simple string', () => {
    const original = 'hello world hello world hello world';
    const packet = compress(original);
    const restored = decompress(packet);
    assert.equal(restored, original);
  });

  it('round-trips an array', () => {
    const original = [1, 2, 3, 1, 2, 3, 1, 2, 3];
    const packet = compress(original);
    assert.ok(packet.array);
    const restored = decompress(packet);
    assert.deepEqual(restored, original);
  });

  it('round-trips through JSON-safe packet', () => {
    const original = { a: 'repeat repeat repeat', b: [1, 1, 1, 1, 1] };
    const packet = compressJSON(original);
    const json = JSON.stringify(packet);
    const restored = decompressJSON(JSON.parse(json));
    assert.deepEqual(restored, original);
  });

  it('actually compresses repetitive input', () => {
    const original = 'abc'.repeat(100);
    const packet = compress(original);
    assert.ok(packet.body.length < original.length, 'compressed body should be shorter');
    assert.ok(packet.dict.length > 0, 'dictionary should contain repeated n-grams');
  });

  it('returns identical output for identical input (deterministic)', () => {
    const original = 'det det det det det det';
    const a = JSON.stringify(compress(original));
    const b = JSON.stringify(compress(original));
    assert.equal(a, b);
  });

  it('round-trips empty string', () => {
    const packet = compress('');
    assert.equal(decompress(packet), '');
  });

  it('round-trips unique string unchanged', () => {
    const original = 'the quick brown fox jumps over the lazy dog once only';
    const packet = compress(original);
    assert.equal(packet.dict.length, 0);
    assert.equal(decompress(packet), original);
  });
});
