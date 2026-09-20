// runtime/src/text_dataset.js
// Build tokenized datasets suitable for GLSLTrainer token mode.
// Returns next-token LM pairs: { x: tokenId[], y: targetTokenId }.

'use strict';
const fs = require('fs');

function asFinitePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function asFiniteNonNegativeInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function normalizeLimit(value, fallback) {
  if (value === Infinity) return Infinity;
  return asFinitePositiveInt(value, fallback);
}

function vocabSizeOf(tokenizer, ids) {
  if (typeof tokenizer?.vocabSize === 'function') {
    const size = tokenizer.vocabSize();
    if (Number.isFinite(size) && size > 0) return size;
  }
  if (typeof tokenizer?.vocabSize === 'number' && Number.isFinite(tokenizer.vocabSize) && tokenizer.vocabSize > 0) {
    return tokenizer.vocabSize;
  }
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  // Fallback: max id + 1 (assume ids start at 0)
  return ids.reduce((a, b) => Math.max(a, b), -1) + 1;
}

function appendNextTokenSamples(ids, seqLen, maxSamples, dataset) {
  for (let i = 0; i + seqLen < ids.length && dataset.length < maxSamples; i++) {
    dataset.push({
      x: ids.slice(i, i + seqLen),
      y: ids[i + seqLen],
    });
  }
}

function datasetToInt32Tensors(dataset) {
  if (!Array.isArray(dataset) || dataset.length === 0) {
    return {
      x: new Int32Array(0),
      y: new Int32Array(0),
      shape: [0, 0],
    };
  }
  const seqLen = dataset[0].x.length;
  const x = new Int32Array(dataset.length * seqLen);
  const y = new Int32Array(dataset.length);
  dataset.forEach((sample, row) => {
    if (!Array.isArray(sample.x) || sample.x.length !== seqLen) {
      throw new Error('All dataset samples must have a consistent sequence length');
    }
    for (let col = 0; col < seqLen; col++) {
      x[row * seqLen + col] = sample.x[col];
    }
    y[row] = sample.y;
  });
  return { x, y, shape: [dataset.length, seqLen] };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeContentValue(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (isPlainObject(entry)) {
          if (typeof entry.text === 'string') return entry.text.trim();
          if (typeof entry.content === 'string') return entry.content.trim();
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (isPlainObject(value)) {
    if (typeof value.text === 'string') return value.text.trim();
    if (typeof value.content === 'string') return value.content.trim();
    if (typeof value.value === 'string') return value.value.trim();
    if (typeof value.message === 'string') return value.message.trim();
  }
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeMessageArray(messages, includeRoles) {
  if (!Array.isArray(messages)) return '';
  const rows = [];
  for (const message of messages) {
    if (typeof message === 'string') {
      const text = message.trim();
      if (text) rows.push(text);
      continue;
    }
    if (!isPlainObject(message)) continue;
    const role = normalizeContentValue(message.role || message.from || message.speaker);
    const content = normalizeContentValue(
      message.content
      ?? message.value
      ?? message.text
      ?? message.message
      ?? message.output
      ?? ''
    );
    if (!content) continue;
    if (includeRoles && role) {
      rows.push(`${role}: ${content}`);
    } else {
      rows.push(content);
    }
  }
  return rows.join('\n');
}

function extractChatTextFromRecord(record, options = {}) {
  const includeRoles = options.includeRoles !== false;
  if (typeof record === 'string') return record.trim();
  if (!isPlainObject(record)) return '';

  const messageCandidates = [
    record.messages,
    record.conversation,
    record.dialogue,
    record.turns,
    record.data,
  ];
  for (const candidate of messageCandidates) {
    const asMessages = normalizeMessageArray(candidate, includeRoles);
    if (asMessages) return asMessages;
  }

  const fields = [
    ['prompt', 'response'],
    ['instruction', 'output'],
    ['input', 'output'],
    ['question', 'answer'],
    ['chosen', null],
    ['text', null],
    ['content', null],
  ];
  for (const [leftKey, rightKey] of fields) {
    const leftValue = normalizeContentValue(record[leftKey]);
    if (!leftValue) continue;
    if (!rightKey) return leftValue;
    const rightValue = normalizeContentValue(record[rightKey]);
    if (rightValue) {
      return `user: ${leftValue}\nassistant: ${rightValue}`;
    }
    return leftValue;
  }

  return '';
}

function parseJsonlLines(raw, sourceFile) {
  const lines = String(raw).split(/\r?\n/);
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid JSONL at ${sourceFile}:${i + 1} (${error.message})`);
    }
  }
  return records;
}

async function buildTokenDataset(opts = {}) {
  // opts: { file, tokenizer, seqLen = 1, maxSamples }
  const file = opts.file;
  const tokenizer = opts.tokenizer;
  const seqLen = asFinitePositiveInt(opts.seqLen, 1);
  const maxSamples = normalizeLimit(opts.maxSamples, Infinity);
  if (!file) throw new Error('file is required');
  if (!tokenizer || typeof tokenizer.encode !== 'function') {
    throw new Error('tokenizer with encode(text) is required');
  }

  const text = fs.readFileSync(file, 'utf8');
  const ids = tokenizer.encode(String(text));
  const dataset = [];
  appendNextTokenSamples(ids, seqLen, maxSamples, dataset);
  const vocabSize = vocabSizeOf(tokenizer, ids);
  const tensors = datasetToInt32Tensors(dataset);

  return {
    dataset,
    vocabSize,
    stats: {
      records: 1,
      usedRecords: dataset.length > 0 ? 1 : 0,
      skippedRecords: dataset.length > 0 ? 0 : 1,
      totalTokens: ids.length,
    },
    tensors,
  };
}

async function buildChatJsonlTokenDataset(opts = {}) {
  // opts: { file, tokenizer, seqLen = 1, maxSamples = Infinity, maxRecords = Infinity, includeRoles = true }
  const file = opts.file;
  const tokenizer = opts.tokenizer;
  const seqLen = asFinitePositiveInt(opts.seqLen, 1);
  const maxSamples = normalizeLimit(opts.maxSamples, Infinity);
  const maxRecords = normalizeLimit(opts.maxRecords, Infinity);
  const includeRoles = opts.includeRoles !== false;
  const minChars = asFiniteNonNegativeInt(opts.minChars, 1);

  if (!file) throw new Error('file is required');
  if (!tokenizer || typeof tokenizer.encode !== 'function') {
    throw new Error('tokenizer with encode(text) is required');
  }

  const raw = fs.readFileSync(file, 'utf8');
  const records = parseJsonlLines(raw, file);

  const dataset = [];
  const allTokenIds = [];
  let usedRecords = 0;
  let skippedRecords = 0;

  for (let i = 0; i < records.length && i < maxRecords && dataset.length < maxSamples; i++) {
    const text = extractChatTextFromRecord(records[i], { includeRoles });
    if (!text || text.length < minChars) {
      skippedRecords++;
      continue;
    }
    const ids = tokenizer.encode(text);
    if (!Array.isArray(ids) || ids.length <= seqLen) {
      skippedRecords++;
      continue;
    }
    usedRecords++;
    allTokenIds.push(...ids);
    appendNextTokenSamples(ids, seqLen, maxSamples, dataset);
  }

  if (dataset.length === 0) {
    throw new Error(`No usable token samples were generated from JSONL file: ${file}`);
  }

  const vocabSize = vocabSizeOf(tokenizer, allTokenIds);
  const tensors = datasetToInt32Tensors(dataset);
  return {
    dataset,
    vocabSize,
    stats: {
      records: Math.min(records.length, maxRecords),
      usedRecords,
      skippedRecords,
      totalTokens: allTokenIds.length,
    },
    tensors,
  };
}

module.exports = {
  buildTokenDataset,
  buildChatJsonlTokenDataset,
  datasetToInt32Tensors,
  extractChatTextFromRecord,
  vocabSizeOf,
};
