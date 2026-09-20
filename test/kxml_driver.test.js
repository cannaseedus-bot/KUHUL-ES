// test/kxml_driver.test.js — KXML inference driver tests
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { KxmlModel, opMatmul, opGelu, GLYPH_TO_FOLD } = require('../runtime/src/kxml_driver.js');

function arr(shape, init) {
  const n = shape.reduce((a, b) => a * b, 1);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = init(i);
  return { array: data, shape };
}

describe('KxmlModel', () => {
  it('executes a tiny forward graph and produces KAST trace', () => {
    const weights = {
      0: arr([2, 3], (i) => i * 0.1),
      1: arr([3, 2], (i) => i * 0.2),
      2: arr([2], () => 0.5),
    };

    const manifest = {
      format: 'khanary-model-stb/v1',
      config: { n_embd: 2, n_layer: 1, vocab: 4, n_ctx: 4, n_head: 1, ln_eps: 1e-5 },
      tensors: {
        'wte': { id: 0, dims: [2, 3] },
        'B': { id: 1, dims: [3, 2] },
        'bias': { id: 2, dims: [2] },
      },
      forward_graph: [
        {
          step: 'embed',
          glyph: 'G_EMBED',
          reads: {
            tokens: '<input>',
            wte: { name: 'wte', id: 0 },
            wpe: { name: 'wte', id: 0 },
          },
        },
        {
          step: 'proj',
          glyph: 'G_MATMUL',
          reads: { B: { name: 'B', id: 1 } },
          bias: 'bias',
        },
        {
          step: 'act',
          glyph: 'G_GELU',
        },
      ],
    };

    const model = new KxmlModel(manifest, weights);
    // tokens: use token id 0 and 1; wte shape is [2,3] so only ids 0/1 valid
    const out = model.forward([0, 1]);
    assert.equal(out.shape[0], 2);
    assert.equal(out.shape[1], 2);

    const kast = model.toKast();
    assert.equal(kast.protocol, 'kfold/1');
    assert.equal(kast.entry_fold, 'fold-0-Pop');
    assert.equal(kast.folds.length, 3);
    assert.equal(kast.folds[0].phase, 'Pop');
    assert.ok(kast.folds[0].nodes.some(n => n.glyph === 'G_EMBED'));
    assert.equal(kast.folds[1].phase, 'Sek');
    assert.ok(kast.folds[1].nodes.some(n => n.glyph === 'G_MATMUL'));
    assert.equal(kast.folds[2].phase, 'Sek');
    assert.ok(kast.folds[2].nodes.some(n => n.glyph === 'G_GELU'));
    assert.equal(kast.folds[0].unfolds.length, 1);
    assert.equal(kast.folds[0].unfolds[0].target, kast.folds[1].id);
  });

  it('matmul and gelu produce finite numbers', () => {
    const x = arr([2, 3], (i) => i - 3);
    const B = arr([3, 2], (i) => (i % 3) - 1);
    const y = opMatmul(x, B, null, false);
    assert.equal(y.shape[0], 2);
    assert.equal(y.shape[1], 2);
    assert.ok(Number.isFinite(y.array[0]));

    const g = opGelu(y);
    assert.equal(g.shape[0], 2);
    assert.equal(g.shape[1], 2);
    assert.ok(g.array.every(Number.isFinite));
  });

  it('maps glyphs to folds', () => {
    assert.equal(GLYPH_TO_FOLD.G_EMBED, 'Pop');
    assert.equal(GLYPH_TO_FOLD.G_LAYERNORM, 'Wo');
    assert.equal(GLYPH_TO_FOLD.G_MATMUL, 'Sek');
    assert.equal(GLYPH_TO_FOLD.G_ATTENTION, 'Sek');
    assert.equal(GLYPH_TO_FOLD.G_GELU, 'Sek');
  });
});
