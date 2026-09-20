// test/trainer_attention.test.js — causal self-attention LM training sanity check

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { GLSLTrainer } = require('../runtime/src/trainer.js');
const { loadTokenizer } = require('../runtime/src/tokenizer.js');
const { buildTokenDataset } = require('../runtime/src/text_dataset.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('GLSLTrainer attention LM', () => {
  async function tinyDataset(seqLen = 4) {
    const text = 'the quick brown fox jumps over the lazy dog.';
    const tmpFile = path.join(os.tmpdir(), 'kuhul_attn_corpus.txt');
    fs.writeFileSync(tmpFile, text);
    const tokenizer = await loadTokenizer({});
    return buildTokenDataset({ file: tmpFile, tokenizer, seqLen, maxSamples: 60 });
  }

  it('trains a tiny multi-head attention LM and loss decreases', async () => {
    const { dataset, vocabSize } = await tinyDataset(4);
    const trainer = new GLSLTrainer({
      vocabSize,
      embedDim: 16,
      hiddenDim: 32,
      nHead: 4,
      lr: 0.15,
      steps: 12,
      verbose: false,
    });

    const initial = dataset.reduce((sum, s) => sum + trainer._grads(s.x, s.y).loss, 0) / dataset.length;

    for (const k of ['gWemb', 'gWqkv', 'gWproj', 'gWffn', 'gWhead']) {
      const g = trainer._grads(dataset[0].x, dataset[0].y);
      assert.ok(Array.isArray(g[k]), `gradient ${k} is an array`);
      assert.ok(!g[k].some(isNaN), `gradient ${k} has no NaN`);
    }

    await trainer.train(dataset.map(s => ({ x: s.x, y: s.y })));
    const final = trainer.losses[trainer.losses.length - 1];
    assert.ok(Number.isFinite(initial), 'initial loss finite');
    assert.ok(Number.isFinite(final), 'final loss finite');
    assert.ok(final < initial, `loss should decrease: ${initial.toFixed(4)} -> ${final.toFixed(4)}`);
  });

  it('generate() produces valid token ids', async () => {
    const { dataset, vocabSize } = await tinyDataset(4);
    const trainer = new GLSLTrainer({
      vocabSize,
      embedDim: 8,
      hiddenDim: 16,
      nHead: 2,
      lr: 0.1,
      steps: 2,
      verbose: false,
    });
    await trainer.train(dataset.map(s => ({ x: s.x, y: s.y })));
    const prompt = dataset[0].x;
    const out = trainer.generate(prompt, 5);
    assert.equal(out.length, prompt.length + 5);
    assert.ok(out.every(t => Number.isInteger(t) && t >= 0 && t < vocabSize));
  });
});
