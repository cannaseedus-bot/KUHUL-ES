// test/cli_train_native.test.js — verify kuhul-es train-native bridge
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'kuhul-es.js');

describe('CLI train-native command', () => {
  it('emits a physics-gated native trainer launch plan in dry-run mode', () => {
    const r = spawnSync(process.execPath, [
      CLI,
      'train-native',
      '--trainer-exe', 'C:\\tmp\\fake\\gpt2_trainer.exe',
      '--model', 'gpt2-medium',
      '--data', 'tokens.bin',
      '--out', 'model.safetensors',
      '--dry-run'
    ], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(r.status, 0, `CLI failed: ${r.stderr}`);
    assert.match(r.stdout, /KUHUL Native Trainer Bridge/);
    assert.match(r.stdout, /GPT2_ADAPTIVE_CLIP=1/);
    assert.match(r.stdout, /physics: gate=/);
    assert.match(r.stdout, /--model gpt2-medium/);
    assert.match(r.stdout, /--data tokens\.bin/);
    assert.match(r.stdout, /--out model\.safetensors/);
  });
});

