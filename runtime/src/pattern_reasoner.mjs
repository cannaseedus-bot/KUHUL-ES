// runtime/src/pattern_reasoner.mjs
// ES module version of pattern_reasoner.js for browser / service worker usage.

// Native RegExp fallback (PCRE2 WASM not bundled in browser build).
function nativeCompile(pattern, flags = '') {
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

async function compilePattern(pattern, flags = '') {
  // If a PCRE2 WASM runtime was loaded into globalThis (sw.js tries to
  // import candidate modules), prefer it because it supports full PCRE2.
  try {
    const mod = typeof globalThis !== 'undefined' ? globalThis.__PCRE2__ : null;
    if (mod && (mod.Pcre2 || mod.default?.Pcre2)) {
      const Pcre2 = mod.Pcre2 || mod.default?.Pcre2 || mod.default || mod;
      try {
        const re = new Pcre2(pattern, flags);
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
      } catch (e) {
        // fall through to native compile
        console.warn('[pattern_reasoner] PCRE2 compile failed, falling back to native RegExp', e && e.message ? e.message : e);
      }
    }
  } catch (e) {
    // ignore and fall back
  }
  return nativeCompile(pattern, flags);
}

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

  addRule(rule) {
    if (!rule.name || !rule.pattern || typeof rule.transform !== 'function') {
      throw new Error('Rule must have name, pattern, and transform()');
    }
    this.rules.push(rule);
    return this;
  }

  async reason(proposition) {
    const results = [];
    for (const rule of this.rules) {
      try {
        const matcher = await withTimeout(() => compilePattern(rule.pattern, rule.flags || ''), 200)();
        if (!matcher) continue;
        this.stats.fallback++;
        const m = await withTimeout(() => matcher.exec(proposition), this.timeoutMs)();
        if (!m) { matcher.destroy(); continue; }
        this.stats.matched++;
        const conclusion = rule.transform(m.groups || [], this.memory, {
          match: m.match, input: m.input, index: m.index,
        });
        if (conclusion && conclusion.proposition) {
          this.stats.fired++;
          results.push({ rule: rule.name, source: proposition, ...conclusion });
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

  async reasonAll(propositions) {
    const out = [];
    for (const p of propositions) {
      out.push(...(await this.reason(p)));
    }
    return out;
  }

  // Convenience: test a single proposition against a raw regex.
  async test(proposition, pattern, flags = '') {
    try {
      const matcher = await withTimeout(() => compilePattern(pattern, flags), 200)();
      if (!matcher) return false;
      const m = await withTimeout(() => matcher.exec(proposition), this.timeoutMs)();
      matcher.destroy();
      return !!m;
    } catch {
      return false;
    }
  }

  resetMemory() {
    this.memory.clear();
  }

  getStats() {
    return { ...this.stats };
  }
}

function nodeProposition(node) {
  return `fold:${node.fold || '?'} node:${node.id || '?'} op:${node.opcode || '?'} symbol:${node.symbol || '?'}`;
}

function metricProposition(key, value) {
  return `metric:${key}=${Number(value).toFixed(5)}`;
}

export {
  SemanticPatternReasoner,
  compilePattern,
  nodeProposition,
  metricProposition,
  nativeCompile,
};
