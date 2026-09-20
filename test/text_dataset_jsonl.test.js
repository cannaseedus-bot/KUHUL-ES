'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadTokenizer } = require('../runtime/src/tokenizer.js');
const {
  buildChatJsonlTokenDataset,
  extractChatTextFromRecord,
} = require('../runtime/src/text_dataset.js');

describe('chat JSONL token dataset builder', () => {
  it('builds token pairs and tensors from Ultrachat-style JSONL', async () => {
    const tmpFile = path.join(os.tmpdir(), `kuhul_chat_${Date.now()}.jsonl`);
    const rows = [
      JSON.stringify({
        messages: [
          { role: 'user', content: 'hello there' },
          { role: 'assistant', content: 'general kenobi' },
        ],
      }),
      JSON.stringify({
        data: [
          { from: 'human', value: 'what is xcfe?' },
          { from: 'gpt', value: 'xcfe is a deterministic control-flow contract.' },
        ],
      }),
    ].join('\n');
    fs.writeFileSync(tmpFile, rows, 'utf8');

    try {
      const tokenizer = await loadTokenizer({});
      const built = await buildChatJsonlTokenDataset({
        file: tmpFile,
        tokenizer,
        seqLen: 4,
        maxSamples: 200,
      });

      assert.ok(built.dataset.length > 0);
      assert.ok(built.vocabSize > 0);
      assert.equal(built.stats.records, 2);
      assert.equal(built.stats.usedRecords, 2);
      assert.equal(built.tensors.shape[1], 4);
      assert.equal(built.tensors.y.length, built.dataset.length);
      assert.equal(built.tensors.x.length, built.dataset.length * 4);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  it('extracts normalized text from common chat record shapes', () => {
    const textA = extractChatTextFromRecord({
      prompt: 'hello',
      response: 'hi',
    });
    assert.ok(textA.includes('user: hello'));
    assert.ok(textA.includes('assistant: hi'));

    const textB = extractChatTextFromRecord({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    });
    assert.equal(textB, 'user: a\nassistant: b');
  });

  it('throws for invalid JSONL input', async () => {
    const tmpFile = path.join(os.tmpdir(), `kuhul_chat_bad_${Date.now()}.jsonl`);
    fs.writeFileSync(tmpFile, '{"messages":[{"role":"user","content":"ok"}]}\n{broken', 'utf8');
    try {
      const tokenizer = await loadTokenizer({});
      await assert.rejects(
        () => buildChatJsonlTokenDataset({ file: tmpFile, tokenizer, seqLen: 2 }),
        /Invalid JSONL/
      );
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });
});
