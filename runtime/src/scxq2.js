/**
 * scxq2 — Sparse Compressed X-json Quaternion v2
 *
 * A small, deterministic, lossless compressor for sequences and strings.
 * Used by K'UHUL as the canonical "compression law": if a state cannot be
 * compressed by this algorithm, it was never executable under the law.
 *
 * @module kuhul-es/runtime/scxq2
 */

'use strict';

const DEFAULT_OPTS = {
  minRepeat: 3,
  maxNgram: 12,
  maxDict: 256,
};

function isPlainString(input) {
  return typeof input === 'string';
}

function asString(input) {
  if (isPlainString(input)) return input;
  if (Array.isArray(input)) return input.map((x) => JSON.stringify(x)).join('\x1f');
  return JSON.stringify(input);
}

function fromString(input, wasArray) {
  if (!wasArray) return input;
  return input.split('\x1f').map((x) => {
    try {
      return JSON.parse(x);
    } catch {
      return x;
    }
  });
}

function buildDictionary(src, opts) {
  const { minRepeat, maxNgram, maxDict } = opts;
  const len = src.length;
  const counts = new Map();

  for (let n = minRepeat; n <= Math.min(maxNgram, len); n++) {
    for (let i = 0; i <= len - n; i++) {
      const gram = src.slice(i, i + n);
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
  }

  const scored = [];
  for (const [gram, count] of counts) {
    if (count < minRepeat) continue;
    const savings = (gram.length - 3) * count;
    if (savings > 0) scored.push({ gram, savings, count });
  }

  scored.sort((a, b) => b.savings - a.savings || a.gram.localeCompare(b.gram));
  return scored.slice(0, maxDict).map((x) => x.gram);
}

function compressString(src, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const dict = buildDictionary(src, o);
  if (dict.length === 0) {
    return { v: 2, dict: [], body: src };
  }

  let body = src;
  const refMap = new Map();
  for (let i = 0; i < dict.length; i++) {
    const token = '\x10' + String.fromCharCode(i);
    refMap.set(dict[i], token);
  }

  // Greedy left-to-right substitution using longest matching dictionary entry.
  const trie = {};
  for (const [gram, token] of refMap) {
    let node = trie;
    for (const ch of gram) {
      if (!node[ch]) node[ch] = {};
      node = node[ch];
    }
    node.$ = token;
  }

  let out = '';
  let i = 0;
  while (i < body.length) {
    let node = trie;
    let longest = null;
    let longestLen = 0;
    let j = i;
    while (j < body.length && node[body[j]]) {
      node = node[body[j]];
      j++;
      if (node.$) {
        longest = node.$;
        longestLen = j - i;
      }
    }
    if (longest) {
      out += longest;
      i += longestLen;
    } else {
      out += body[i];
      i++;
    }
  }

  return { v: 2, dict, body: out };
}

function decompressString({ v, dict, body }) {
  if (v !== 2) throw new Error(`scxq2: unsupported version ${v}`);
  if (!dict || dict.length === 0) return body;

  let out = body;
  // Replace tokens in reverse index order to avoid prefix collisions.
  for (let i = dict.length - 1; i >= 0; i--) {
    const token = '\x10' + String.fromCharCode(i);
    out = out.split(token).join(dict[i]);
  }
  return out;
}

/**
 * Compress an arbitrary value (string, array, or JSON-serializable object).
 * Returns a plain object that round-trips with `decompress`.
 */
function compress(input, opts = {}) {
  const wasArray = Array.isArray(input);
  const src = asString(input);
  const compressed = compressString(src, opts);
  if (wasArray) compressed.array = true;
  return compressed;
}

/**
 * Decompress a value produced by `compress`.
 */
function decompress(packet) {
  const src = decompressString(packet);
  if (packet.array) return fromString(src, true);

  // If the body looks like JSON, try to parse it back.
  if (src.length > 0 && (src[0] === '{' || src[0] === '[')) {
    try {
      return JSON.parse(src);
    } catch {
      return src;
    }
  }
  return src;
}

/**
 * Compress a JSON-serializable object and return a JSON-stringify-safe packet.
 * Dictionary entries containing the unit separator are escaped.
 */
function compressJSON(input, opts = {}) {
  const packet = compress(input, opts);
  const safe = {
    v: packet.v,
    dict: packet.dict.map((d) => d.replace(/\x1f/g, '\\u001f')),
    body: packet.body,
  };
  if (packet.array) safe.array = true;
  return JSON.parse(JSON.stringify(safe));
}

/**
 * Decompress a packet produced by `compressJSON`.
 */
function decompressJSON(packet) {
  const restored = {
    v: packet.v,
    dict: packet.dict.map((d) => d.replace(/\\u001f/g, '\x1f')),
    body: packet.body,
  };
  if (packet.array) restored.array = true;
  return decompress(restored);
}

module.exports = {
  compress,
  decompress,
  compressJSON,
  decompressJSON,
};
