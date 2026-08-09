// test/trainer_semantic.test.js — semantic reasoning over GLSL trainer skeletons
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SemanticTrainer, DEFAULT_TRAINING_RULES } = require('../runtime/src/trainer_semantic.js');
const { GLSLTrainer } = require('../runtime/src/trainer.js');
const { nodeProposition } = require('../runtime/src/pattern_reasoner.js');

describe('SemanticTrainer', () => {
  it('analyzes KAST node propositions and emits advice', async () => {
    const st = new SemanticTrainer();
    const nodes = [
      { id: 'EMBED',    fold: 'Pop',   lane: 'input',     glyph: 'embed',     opcode: 'EMBED',  gravity: 'Embed',  symbol: 'W_embed', shape: [40, 2] },
      { id: 'LAYERNORM', fold: 'Wo',    lane: 'normalize', glyph: 'layernorm', opcode: 'LNORM', gravity: 'Heavy', symbol: 'ln_gamma', shape: [40] },
      { id: 'FFN',      fold: 'Sek',   lane: 'compute',   glyph: 'gelu',      opcode: 'FFN',    gravity: 'Normal', symbol: 'W_ffn', shape: [40, 40] },
      { id: 'LM_HEAD',  fold: 'Xul',   lane: 'output',    glyph: 'lm_head',   opcode: 'LMHEAD', gravity: 'Heavy', symbol: 'W_lm_head', shape: [1, 40] },
    ];

    const { conclusions, advice } = await st.analyze(nodes, { entropy: 0.42 });

    assert.ok(conclusions.length > 0);
    assert.ok(advice.some(a => a.target === 'lr' && a.node === 'LAYERNORM'), 'Heavy LAYERNORM should lower lr');
    assert.ok(advice.some(a => a.target === 'lr' && a.node === 'LM_HEAD'), 'Heavy LM_HEAD should lower lr');
    assert.ok(advice.some(a => a.target === 'phase' && a.value === 'Xul'), 'High entropy should request consolidate');
  });

  it('detects repeated folds via backreference', async () => {
    const st = new SemanticTrainer();
    const nodes = [
      { id: 'n1', fold: 'Sek', lane: 'compute', glyph: 'gelu', opcode: 'FFN', gravity: 'Normal', symbol: 'W_ffn' },
      { id: 'n2', fold: 'Sek', lane: 'compute', glyph: 'gelu', opcode: 'FFN', gravity: 'Normal', symbol: 'W_ffn2' },
    ];
    const joined = nodeProposition(nodes[0]) + ' | ' + nodeProposition(nodes[1]);
    const { conclusions } = await st.analyze(nodes);
    // also feed the joined trace directly so the backref rule can see both
    const c2 = await st.reasoner.reason(joined);

    const warning = conclusions.find(c => c.proposition.includes('repeats'))
      || c2.find(c => c.proposition.includes('repeats'));
    assert.ok(warning, 'should detect Sek repeats');
  });

  it('adjusts a training step from advice', async () => {
    const st = new SemanticTrainer();
    const base = { lr: 0.2 };
    const adjusted = st.adjustStep(base, [
      { target: 'lr', action: 'scale', value: 0.85 },
      { target: 'lr', action: 'scale', value: 0.85 },
      { target: 'attention', action: 'raise', value: 0.1 },
    ]);

    assert.equal(Math.round(adjusted.lr * 1e6), Math.round(0.2 * 0.85 * 0.85 * 1e6));
    assert.equal(adjusted.attentionDelta, 0.1);
    assert.deepEqual(adjusted.phaseInserts, []);
  });

  it('low gravity gate raises pressure advice', async () => {
    const st = new SemanticTrainer();
    const { advice } = await st.analyze([], { gravity: 5.0 });
    assert.ok(advice.some(a => a.target === 'pressure' && a.value > 0));
  });

  it('GLSLTrainer accepts a SemanticTrainer and logs advice per epoch', async () => {
    const semantic = new SemanticTrainer({ interval: 1 });
    const trainer = new GLSLTrainer({
      inputDim: 2, hiddenDim: 8, outputDim: 1,
      lr: 0.2, steps: 5, momentum: 0.9,
      verbose: false,
      semanticTrainer: semantic,
    });

    const dataset = Array.from({ length: 20 }, (_, i) => {
      const x = (i / 20) * 2 - 1;
      return { x: [x, x * x], y: [Math.sin(2 * Math.PI * x) + 0.5] };
    });

    const result = await trainer.train(dataset);
    assert.ok(Array.isArray(result.semanticAdvice));
    assert.equal(result.semanticAdvice.length, 5);
    // heavy gravity nodes should advise LR scaling
    const allAdvice = result.semanticAdvice.flat();
    assert.ok(allAdvice.some(a => a.target === 'lr' && a.action === 'scale'));
  });
});
