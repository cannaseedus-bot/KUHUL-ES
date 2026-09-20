// runtime/src/think.mjs
// ES module version of think.js for browser / service worker usage.

import { SemanticPatternReasoner } from './pattern_reasoner.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const DEFAULT_RULES = [
  {
    id: 'observe-state',
    when: (b) => b.proposition.startsWith('observe:'),
    then: (b) => {
      const target = b.proposition.slice('observe:'.length).trim();
      return { proposition: `believe: ${target} is monitored`, fold: 'Pop', confidence: 0.9 };
    },
  },
  {
    id: 'plan-from-goal',
    when: (b) => b.proposition.startsWith('goal:'),
    then: (b) => {
      const rest = b.proposition.slice('goal:'.length).trim();
      return { proposition: `plan: steps toward ${rest}`, fold: 'Yax', confidence: 0.75 };
    },
  },
  {
    id: 'execute-plan',
    when: (b) => b.proposition.startsWith('plan:'),
    then: (b) => {
      const rest = b.proposition.slice('plan:'.length).trim();
      return { proposition: `execute: dispatch ${rest}`, fold: 'Sek', confidence: 0.7 };
    },
  },
  {
    id: 'consolidate-result',
    when: (b) => b.proposition.startsWith('execute:'),
    then: (b) => {
      const rest = b.proposition.slice('execute:'.length).trim();
      return { proposition: `commit: ${rest} recorded`, fold: 'Xul', confidence: 0.95 };
    },
  },
  {
    id: 'entropy-warning',
    when: (b) => b.proposition.startsWith('metric:entropy'),
    then: (b) => {
      const value = parseFloat(b.proposition.split('=')[1]) || 0;
      if (value > 0.35) {
        return { proposition: 'warn: entropy high, consolidate before project', fold: 'Ch\'en', confidence: 0.85 };
      }
      return null;
    },
  },
  {
    id: 'gravity-gate',
    when: (b) => b.proposition.startsWith('metric:gravity'),
    then: (b) => {
      const value = parseFloat(b.proposition.split('=')[1]) || 1.0;
      if (value < 8.0) {
        return { proposition: 'warn: gravity gate low, increase pressure/attention', fold: 'Wo', confidence: 0.8 };
      }
      return null;
    },
  },
];

class KuhulThinkEngine {
  constructor(opts = {}) {
    this.rules = opts.rules || DEFAULT_RULES.slice();
    this.beliefs = new Map();
    this.thoughts = [];
    this.maxDepth = opts.maxDepth ?? 4;
    this.maxBreadth = opts.maxBreadth ?? 16;
    this.maxRules = opts.maxRules ?? 64;
    this.stats = { fired: 0, pruned: 0, depthReached: 0 };
    this._ruleHits = new Map();
    this.patternReasoner = opts.patternReasoner || new SemanticPatternReasoner({ timeoutMs: opts.timeoutMs ?? 1000 });
  }

  async think(query, context = {}) {
    this.thoughts = [];
    this.stats = { fired: 0, pruned: 0, depthReached: 0 };

    const seed = this._belief('q0', query, 'Pop', 1.0, 'query');
    const queue = [{ belief: seed, depth: 0, parent: null }];

    for (const b of this.beliefs.values()) {
      queue.push({ belief: b, depth: 0, parent: null });
    }

    const patternConclusions = await this.patternReasoner.reason(query);
    for (const c of patternConclusions) {
      const child = this._belief(
        `t${this.thoughts.length}`,
        c.proposition,
        c.fold || 'Sek',
        clamp(c.confidence || 0.5, 0, 1),
        c.rule || 'pattern',
        null
      );
      this.thoughts.push(child);
      queue.push({ belief: child, depth: 1, parent: child });
    }

    const seen = new Set();
    let breadth = 0;

    while (queue.length > 0 && breadth < this.maxBreadth) {
      const { belief, depth, parent } = queue.shift();
      if (depth > this.stats.depthReached) this.stats.depthReached = depth;
      if (depth >= this.maxDepth) {
        this.stats.pruned++;
        continue;
      }

      const derived = await this.patternReasoner.reason(belief.proposition);
      for (const c of derived) {
        if (breadth >= this.maxBreadth) break;
        const key = `${c.rule}:${c.proposition}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const child = this._belief(
          `t${this.thoughts.length}`,
          c.proposition,
          c.fold || 'Sek',
          clamp(c.confidence || 0.5, 0, 1),
          c.rule,
          belief.id
        );
        this.thoughts.push(child);
        queue.push({ belief: child, depth: depth + 1, parent: child });
        breadth++;
        this.stats.fired++;
      }

      for (const rule of this.rules) {
        if (!rule.when(belief)) continue;
        this.stats.fired++;
        this._ruleHits.set(rule.id, (this._ruleHits.get(rule.id) || 0) + 1);

        const conclusion = await Promise.resolve(rule.then(belief));
        if (!conclusion || !conclusion.proposition) continue;

        const key = `${rule.id}:${conclusion.proposition}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const child = this._belief(
          `t${this.thoughts.length}`,
          conclusion.proposition,
          conclusion.fold || 'Sek',
          clamp(conclusion.confidence || 0.5, 0, 1),
          rule.id,
          parent ? parent.id : null
        );

        this.thoughts.push(child);
        queue.push({ belief: child, depth: depth + 1, parent: child });
        breadth++;

        if (context.learn === true) {
          this.beliefs.set(child.id, child);
        }
      }
    }

    return {
      query,
      thoughts: this.thoughts,
      stats: this.stats,
      hash: this._hashThoughts(),
    };
  }

  learnRule(rule) {
    if (this.rules.length >= this.maxRules) {
      return { ok: false, reason: `rule limit reached (${this.maxRules})` };
    }
    if (!rule.id || typeof rule.when !== 'function' || typeof rule.then !== 'function') {
      return { ok: false, reason: 'rule must have id, when(), then()' };
    }
    this.rules.push(rule);
    return { ok: true, ruleCount: this.rules.length };
  }

  async learnPatternRule(name, pattern, flags, transform) {
    try {
      const matcher = await this.patternReasoner.compilePattern(pattern, flags || '');
      matcher.destroy?.();
    } catch (err) {
      return { ok: false, reason: `invalid pattern: ${err.message}` };
    }
    return this.learnRule({
      id: `pattern:${name}`,
      when: (b) => true,
      then: async (b) => {
        const matcher = await this.patternReasoner.compilePattern(pattern, flags || '');
        const m = matcher.exec(b.proposition);
        matcher.destroy?.();
        if (!m) return null;
        const conclusion = transform(m.groups || [], this.patternReasoner.memory, m);
        return conclusion || null;
      },
    });
  }

  learnBelief(proposition, fold = 'Wo', confidence = 0.8, source = 'external') {
    const id = `b${this.beliefs.size}`;
    const b = this._belief(id, proposition, fold, clamp(confidence, 0, 1), source);
    this.beliefs.set(id, b);
    return b;
  }

  forgetBelief(id) {
    return this.beliefs.delete(id);
  }

  beliefsList() {
    return Array.from(this.beliefs.values());
  }

  rulesList() {
    return this.rules.map(r => ({ id: r.id, hits: this._ruleHits.get(r.id) || 0 }));
  }

  reflect(topic) {
    const relevant = Array.from(this.beliefs.values())
      .filter(b => b.proposition.includes(topic))
      .sort((a, b) => b.confidence - a.confidence);
    return {
      topic,
      beliefs: relevant,
      summary: relevant.length
        ? `Knows ${relevant.length} proposition(s) about "${topic}"`
        : `No propositions about "${topic}"`,
    };
  }

  _belief(id, proposition, fold, confidence, source, parentId = null) {
    const b = {
      id,
      kind: 'thought',
      fold: fold || 'Sek',
      lane: 'reason',
      glyph: 'Noj',
      opcode: 'INFERE',
      symbol: proposition.length > 64 ? proposition.slice(0, 64) + '…' : proposition,
      proposition,
      confidence,
      source,
      parentId,
      tick: this.thoughts.length,
      timestamp: new Date().toISOString(),
    };
    b.hash = this._hashNode(b);
    return b;
  }

  _hashNode(node) {
    const { timestamp, ...hashable } = node;
    const canonical = JSON.stringify(hashable, Object.keys(hashable).sort());
    return this._sha256(canonical);
  }

  _hashThoughts() {
    const canonical = this.thoughts.map(t => t.hash).join('|');
    return this._sha256(canonical);
  }

  async _sha256(str) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16).padStart(16, '0');
  }
}

export { KuhulThinkEngine, DEFAULT_RULES, SemanticPatternReasoner };
