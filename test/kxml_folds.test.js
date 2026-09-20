// test/kxml_folds.test.js — validate KxmlModel.toKast() emits kfold/1 folds

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { KxmlModel } = require('../runtime/src/kxml_driver.js');

function arr(shape, init) {
  const n = shape.reduce((a, b) => a * b, 1);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = init(i);
  return { array: data, shape };
}

const VALID_PHASES = new Set(['Pop', 'Wo', 'Yax', 'Sek', 'Ch\'en', 'Xul']);

describe('KxmlModel kfold/1 output', () => {
  function makeModel() {
    const weights = {
      0: arr([2, 3], (i) => i * 0.1),
      1: arr([3, 2], (i) => i * 0.2),
      2: arr([2], () => 0.5),
    };
    const manifest = {
      format: 'khanary-model-stb/v1',
      config: { n_embd: 2, n_layer: 1, vocab: 4, n_ctx: 4, n_head: 1, ln_eps: 1e-5 },
      tensors: {
        wte: { id: 0, dims: [2, 3] },
        B: { id: 1, dims: [3, 2] },
        bias: { id: 2, dims: [2] },
      },
      forward_graph: [
        { step: 'embed', glyph: 'G_EMBED', reads: { tokens: '<input>', wte: { id: 0 }, wpe: { id: 0 } } },
        { step: 'ln_1', glyph: 'G_LAYERNORM', reads: { gamma: { id: 2 }, beta: { id: 2 } } },
        { step: 'proj', glyph: 'G_MATMUL', reads: { B: { id: 1 } }, bias: 'bias' },
        { step: 'act', glyph: 'G_GELU' },
      ],
    };
    return new KxmlModel(manifest, weights);
  }

  it('returns the kfold/1 protocol envelope', () => {
    const model = makeModel();
    model.forward([0, 1]);
    const kast = model.toKast();
    assert.equal(kast.protocol, 'kfold/1');
    assert.ok(kast.entry_fold, 'has entry_fold');
    assert.ok(Array.isArray(kast.folds), 'has folds array');
    assert.ok(kast.folds.length > 0, 'has at least one fold');
  });

  it('every fold conforms to the kfold/1 schema shape', () => {
    const model = makeModel();
    model.forward([0, 1]);
    const kast = model.toKast();
    for (let i = 0; i < kast.folds.length; i++) {
      const f = kast.folds[i];
      assert.ok(f.id, `fold ${i} has id`);
      assert.ok(VALID_PHASES.has(f.phase), `fold ${i} has valid phase ${f.phase}`);
      assert.equal(f.axis, 'vertical');
      assert.ok(['collapsed', 'admitted', 'unfolded', 'executing', 'committed'].includes(f.state), `fold ${i} state valid`);
      assert.equal(typeof f.depth, 'number');
      assert.ok(f.depth >= 0, `fold ${i} depth non-negative`);
      assert.ok(Array.isArray(f.nodes), `fold ${i} has nodes array`);
      assert.ok(f.nodes.length > 0, `fold ${i} has at least one node`);
      assert.equal(f.parent, i === 0 ? null : kast.folds[i - 1].id);
    }
  });

  it('every node inside a fold is a linear lane node with operands', () => {
    const model = makeModel();
    model.forward([0, 1]);
    const kast = model.toKast();
    for (const f of kast.folds) {
      for (const n of f.nodes) {
        assert.ok(n.id);
        assert.equal(typeof n.index, 'number');
        assert.equal(n.axis, 'linear');
        assert.equal(typeof n.lane, 'string');
        assert.equal(typeof n.glyph, 'string');
        assert.equal(typeof n.opcode, 'string');
        assert.ok(Array.isArray(n.operands));
      }
    }
  });

  it('links folds with control unfolds', () => {
    const model = makeModel();
    model.forward([0, 1]);
    const kast = model.toKast();
    for (let i = 0; i < kast.folds.length - 1; i++) {
      const unfolds = kast.folds[i].unfolds;
      assert.ok(unfolds.some(u => u.target === kast.folds[i + 1].id && u.gate === 'always'));
    }
  });

  it('maps the Pop entry fold to the G_EMBED glyph', () => {
    const model = makeModel();
    model.forward([0, 1]);
    const kast = model.toKast();
    const entry = kast.folds.find(f => f.id === kast.entry_fold);
    assert.ok(entry);
    assert.equal(entry.phase, 'Pop');
    assert.ok(entry.nodes.some(n => n.glyph === 'G_EMBED'));
  });
});
