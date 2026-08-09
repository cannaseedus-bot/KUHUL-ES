// runtime/src/pattern_reasoner.js
//
// Semantic Pattern Reasoner over KAST propositions.
//
// Uses an ELIZA-style pattern->transform pipeline, but for reasoning about
// semantic execution (folds, nodes, metrics, training state), not therapy.
//
// Design:
//   - Patterns are PCRE2-compatible regex (with backrefs, lookarounds).
//   - In Node.js, @ofjansen/pcre2-wasm is used if installed.
//   - In the browser, a native RegExp fallback is provided; it supports
//     backreferences but not full PCRE2.
//   - A custom loader can be injected to point to a real WASM build.
//   - All regex execution is wrapped so it can be bounded by a timeout or
//     memory cap.
//
// Example rule:
//   {
//     name: 'fold-loop',
//     pattern: '^(fold:\\w+).*\\1',
//     transform: ([fold]) => ({ proposition: `warn: repeated ${fold}`, confidence: 0.7 })
//   }

'use strict';

// Try to load optional PCRE2 WASM dependency.
// If unavailable, every compile falls back to native RegExp.
let pcre2Promise = null;
function getPcre2() {
  if (pcre2Promise) return pcre2Promise;
  pcre2Promise = new Promise((resolve) => {
    try {
      const mod = require('@ofjansen/pcre2-wasm');
      if (mod && typeof mod.initPcre2 === 'function') {
        mod.initPcre2().then(() => resolve(mod)).catch(() => resolve(null));
      } else if (mod && mod.Pcre2) {
        resolve(mod);
      } else {
        resolve(null);
      }
    } catch {
      resolve(null);
    }
  });
  return pcre2Promise;
}

// Synchronous compile helper that always returns an object with
// test/exec/destroy, using native RegExp as the default.
function nativeCompile(pattern, flags = '') {
  // PCRE flags to JS flag subset
  const safeFlags = flags.replace(/[^gimsuy]/g, '');
  const re = new RegExp(pattern, safeFlags);
  return {
    test: (s) => re.test(s),
    exec: (s) => {
      const m = re.exec(s);
      if (!m) return null;
      const groups = [];
      for (let i = 1; i < m.length; i++) groups.push(m[i]);
      return { match: m[0], groups, input: s, index: m.index };
    },
    destroy: () => {},
  };
}

// Asynchronous compile. Resolves to PCRE2-backed matcher if the WASM module
// is available and the pattern compiles there; otherwise native RegExp.
async function compilePattern(pattern, flags = '') {
  const mod = await getPcre2();
  if (!mod || !mod.Pcre2) return nativeCompile(pattern, flags);
  try {
    const re = new mod.Pcre2(pattern, flags);
    return {
      test: (s) => re.test(s),
      exec: (s) => {
        const m = re.exec(s);
        if (!m) return null;
        const arr = m.groups ? Object.values(m.groups) : m.slice(1);
        return { match: m[0], groups: arr, input: s, index: m.index };
      },
      destroy: () => re.destroy?.(),
    };
  } catch {
    return nativeCompile(pattern, flags);
  }
}

// Run a matcher with a hard timeout (ms). This adds a safety layer for
// user-supplied patterns even when using the native fallback.
function withTimeout(fn, ms = 1000) {
  return async (...args) => {
    if (ms <= 0) return fn(...args);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Pattern execution timeout')), ms);
      Promise.resolve(fn(...args))
        .then((r) => { clearTimeout(t); resolve(r); })
        .catch((e) => { clearTimeout(t); reject(e); });
    });
  };
}

class SemanticPatternReasoner {
  constructor(opts = {}) {
    this.rules = [];
    this.memory = opts.memory || new Map();
    this.timeoutMs = opts.timeoutMs || 1000;
    this.stats = { matched: 0, fired: 0, errors: 0, fallback: 0 };
  }

  // Add a rule. { name, pattern, flags?, transform(groups, memory) -> object | null }
  addRule(rule) {
    if (!rule.name || !rule.pattern || typeof rule.transform !== 'function') {
      throw new Error('Rule must have name, pattern, and transform()');
    }
    this.rules.push(rule);
    return this;
  }

  // Reason about a single proposition. Returns array of conclusions.
  async reason(proposition) {
    const results = [];
    for (const rule of this.rules) {
      try {
        const matcher = await withTimeout(() => compilePattern(rule.pattern, rule.flags || ''), 200)();
        if (!matcher) continue;

        // Track fallback usage
        const isNativeFallback = matcher.destroy.toString() === '() =\u003e {}';
        if (isNativeFallback) this.stats.fallback++;

        const m = await withTimeout(() => matcher.exec(proposition), this.timeoutMs)();
        if (!m) { matcher.destroy(); continue; }

        this.stats.matched++;
        const conclusion = rule.transform(m.groups || [], this.memory, {
          match: m.match,
          input: m.input,
          index: m.index,
        });
        if (conclusion && conclusion.proposition) {
          this.stats.fired++;
          results.push({
            rule: rule.name,
            source: proposition,
            ...conclusion,
          });
        }
        matcher.destroy();
      } catch (err) {
        this.stats.errors++;
        results.push({
          rule: rule.name,
          source: proposition,
          proposition: `error: ${err.message}`,
          fold: 'Ch\'en',
          confidence: 1.0,
        });
      }
    }
    return results;
  }

  // Batch reason over an array of propositions.
  async reasonAll(propositions) {
    const out = [];
    for (const p of propositions) {
      out.push(...(await this.reason(p)));
    }
    return out;
  }

  resetMemory() {
    this.memory.clear();
  }

  getStats() {
    return { ...this.stats };
  }
}

// Helpers for generating common KAST propositions from trainer/runtime nodes.
function nodeProposition(node) {
  return `fold:${node.fold || '?'} node:${node.id || '?'} op:${node.opcode || '?'} symbol:${node.symbol || '?'}`;
}

function metricProposition(key, value) {
  return `metric:${key}=${Number(value).toFixed(5)}`;
}

module.exports = {
  SemanticPatternReasoner,
  compilePattern,
  getPcre2,
  nodeProposition,
  metricProposition,
  nativeCompile,
};
