// runtime/src/tokenizer.js
// CommonJS tokenizer adapter. Tries to load @huggingface/tokenizers if available,
// otherwise falls back to a simple character-level tokenizer.

'use strict';
const fs = require('fs');

async function tryLoadHF(path) {
  try {
    const tk = require('@huggingface/tokenizers');
    if (tk && typeof tk.Tokenizer !== 'undefined') {
      // Tokenizer.fromFile returns a Promise in newer bindings
      if (typeof tk.Tokenizer.fromFile === 'function') {
        const tokenizer = await tk.Tokenizer.fromFile(path);
        return {
          encode: (text) => tokenizer.encode(text).ids,
          decode: (ids) => tokenizer.decode(ids),
          vocabSize: () => (tokenizer.getVocab ? Object.keys(tokenizer.getVocab()).length : null),
          tokenToId: (t) => (tokenizer.tokenToId ? tokenizer.tokenToId(t) : null),
          idToToken: (id) => (tokenizer.idToToken ? tokenizer.idToToken(id) : null),
        };
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

function simpleCharTokenizer() {
  const vocab = new Map();
  let next = 0;
  return {
    encode: (text) => {
      const out = [];
      for (const ch of String(text)) {
        if (!vocab.has(ch)) vocab.set(ch, next++);
        out.push(vocab.get(ch));
      }
      return out;
    },
    decode: (ids) => {
      const inv = Array.from(vocab.entries()).reduce((acc, [k, v]) => (acc[v] = k, acc), {});
      return ids.map(i => inv[i] || '?').join('');
    },
    vocabSize: () => vocab.size,
    tokenToId: (t) => vocab.get(t) ?? null,
    idToToken: (id) => {
      for (const [k, v] of vocab.entries()) if (v === id) return k; return null;
    }
  };
}

async function loadTokenizer(options = {}) {
  // options.path: path to tokenizer.json (HF format) if using @huggingface/tokenizers
  if (options.path) {
    const hf = await tryLoadHF(options.path);
    if (hf) return hf;
  }

  // Try to discover a tokenizer.json in cwd/node_modules or provided path
  try {
    const candidate = options.path || 'tokenizer.json';
    if (fs.existsSync(candidate)) {
      const hf = await tryLoadHF(candidate);
      if (hf) return hf;
    }
  } catch (e) { /* ignore */ }

  // Fallback
  return simpleCharTokenizer();
}

module.exports = { loadTokenizer, simpleCharTokenizer };
