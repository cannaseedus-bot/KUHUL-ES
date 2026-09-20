'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { GLSLTrainer } = require('../runtime/src/trainer.js');
const { loadTokenizer } = require('../runtime/src/tokenizer.js');
const { buildTokenDataset } = require('../runtime/src/text_dataset.js');

describe('GLSLTrainer token mode', () => {
  it('trains a tiny LM on character tokens and loss decreases', async () => {
    const text = 'the quick brown fox jumps over the lazy dog. the quick brown fox jumps over the lazy dog.';
    const tmpFile = path.join(os.tmpdir(), 'kuhul_token_corpus.txt');
    fs.writeFileSync(tmpFile, text);

    const tokenizer = await loadTokenizer({});
    const { dataset, vocabSize } = await buildTokenDataset({ file: tmpFile, tokenizer, seqLen: 4, maxSamples: 200 });
    assert.ok(dataset.length > 0);
    assert.ok(typeof vocabSize === 'number' && vocabSize > 0);

    const trainer = new GLSLTrainer({
      vocabSize,
      embedDim: 16,
      hiddenDim: 32,
      lr: 0.15,
      steps: 30,
      momentum: 0.9,
      verbose: false,
    });

    const result = await trainer.train(dataset);
    assert.ok(result.losses.length === 30);
    assert.ok(result.finalLoss < result.losses[0], `loss should decrease: ${result.losses[0].toFixed(4)} -> ${result.finalLoss.toFixed(4)}`);

    const model = trainer.model();
    assert.equal(model.protocol, 'kast/1');
    assert.ok(model.nodes.some(n => n.id === 'EMBED'));
    assert.ok(model.artifacts.some(a => a.id === 'EMBED_weights'));
    assert.ok(model.tokenizer.vocab_size > 0);

    // Greedy generation should produce integer token ids
    const seed = dataset[0].x;
    const generated = trainer.generate(seed, 5);
    assert.equal(generated.length, seed.length + 5);
    assert.ok(generated.every(t => typeof t === 'number'));

    fs.unlinkSync(tmpFile);
  });
});
