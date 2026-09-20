// runtime/src/response-pattern.js
//
// Response pattern engine for KUHUL-E. Maintains a library of response patterns,
// matches them against the current domain and query, and expands them through
// the FoldEngine as kfold/1 semantic folds.

'use strict';

const { FoldEngine } = require('./fold-engine');
const { DomainStack } = require('./domain-stack');

class ResponsePatternEngine {
  constructor(domainStack, opts = {}) {
    this.domainStack = domainStack || new DomainStack();
    this.patterns = new Map();
    this.responseHistory = [];
    this.learningRate = opts.learningRate || 0.01;
    this.foldEngine = opts.foldEngine || new FoldEngine({ maxDepth: opts.maxDepth || 10 });
  }

  registerPattern(patternId, config) {
    this.patterns.set(patternId, {
      id: patternId,
      domain: config.domain || 'general',
      trigger: config.trigger || [],
      template: config.template,
      branches: config.branches || {},
      weight: config.weight || 1.0,
      metadata: config.metadata || {},
    });
    return this;
  }

  findPattern(query, domainId) {
    const q = (query || '').toLowerCase();
    const candidates = [];

    for (const [id, pattern] of this.patterns) {
      if (pattern.domain !== domainId && pattern.domain !== 'general') continue;

      let matchScore = 0;
      for (const trigger of pattern.trigger) {
        if (q.includes(trigger.toLowerCase())) matchScore += 1;
      }

      if (matchScore > 0) {
        candidates.push({ ...pattern, matchScore });
      }
    }

    return candidates.sort((a, b) => (b.matchScore * b.weight) - (a.matchScore * a.weight))[0] || null;
  }

  async generateResponse(pattern, context, research) {
    const domain = this.domainStack.getCurrentDomain();
    const fold = this._createFold(pattern, context, research, domain);

    // Register and expand the response fold in the fold engine.
    this.foldEngine.registerFold(fold);
    this.foldEngine.unfold(fold.id, 'explicit', { query: context.query, domain: domain?.id });

    const expanded = this.foldEngine.getFold(fold.id);
    const nodes = expanded ? expanded.nodes : fold.nodes;
    const responseText = this._formatNodes(nodes);

    this.responseHistory.push({
      timestamp: Date.now(),
      pattern: pattern.id,
      domain: domain?.id || 'general',
      foldId: fold.id,
      responseText,
      research: research?.results || [],
    });

    return {
      id: fold.id,
      text: responseText,
      foldId: fold.id,
      nodes,
      metadata: {
        pattern: pattern.id,
        domain: domain?.id || 'general',
        context,
        research,
      },
    };
  }

  _createFold(pattern, context, research, domain) {
    const phase = (domain?.glyphs?.[0]) || 'Sek';
    const nodes = [];

    nodes.push({
      id: 'response_start',
      index: 0,
      axis: 'linear',
      lane: 'response',
      glyph: phase,
      opcode: 'RESPONSE_START',
      symbol: 'response_start',
      operands: [{ type: 'text', value: pattern.template?.prefix || 'Let me help you with that...' }],
      attributes: { domain: domain?.id || 'general' },
    });

    for (const branch of this._generateBranches(pattern, context, research, domain)) {
      nodes.push({
        id: branch.id,
        index: nodes.length,
        axis: 'linear',
        lane: 'branch',
        glyph: branch.glyph || phase,
        opcode: branch.opcode || 'BRANCH',
        symbol: branch.id,
        operands: branch.operands || [],
        attributes: branch.attributes || {},
      });
    }

    return {
      id: `response_${Date.now()}`,
      phase,
      axis: 'vertical',
      state: 'collapsed',
      parent: null,
      depth: 0,
      nodes,
      unfolds: [],
      attributes: {
        pattern: pattern.id,
        domain: domain?.id || 'general',
        context,
        research,
      },
    };
  }

  _generateBranches(pattern, context, research, domain) {
    const branches = [];

    if (domain && pattern.branches[domain.id]) {
      const branch = pattern.branches[domain.id];
      branches.push({
        id: `branch_${domain.id}`,
        opcode: 'DOMAIN_BRANCH',
        glyph: 'Sek',
        operands: Array.isArray(branch.steps) ? branch.steps.map((s) => ({ type: 'text', value: s })) : [{ type: 'text', value: JSON.stringify(branch) }],
        attributes: { domain: domain.id },
      });
    }

    if (research && research.results.length > 0) {
      branches.push({
        id: 'research_branch',
        opcode: 'RESEARCH',
        glyph: 'Wo',
        operands: research.results.map((r) => ({ type: 'research', value: r.content, source: r.source, confidence: r.confidence })),
        attributes: { count: research.results.length },
      });
    }

    if (context.followup) {
      branches.push({
        id: 'followup_branch',
        opcode: 'FOLLOWUP',
        glyph: 'Ch\'en',
        operands: [{ type: 'text', value: context.followup }],
        attributes: { type: 'deeper' },
      });
    }

    if (branches.length === 0) {
      branches.push({
        id: 'default_branch',
        opcode: 'DEFAULT',
        glyph: 'Xul',
        operands: [{ type: 'text', value: pattern.template?.fallback || 'I understand.' }],
        attributes: {},
      });
    }

    return branches;
  }

  _formatNodes(nodes) {
    return nodes
      .map((n) => {
        if (n.opcode === 'RESPONSE_START' && n.operands?.[0]?.value) return n.operands[0].value;
        if (n.operands) {
          return n.operands
            .map((o) => o.value || o.content || (typeof o === 'string' ? o : JSON.stringify(o)))
            .filter(Boolean)
            .join(' ');
        }
        return n.content || '';
      })
      .filter(Boolean)
      .join(' ');
  }

  learn(responseId, feedback, query) {
    const history = this.responseHistory.find((h) => h.foldId === responseId || h.responseText === responseId);
    if (!history) return;

    const pattern = this.patterns.get(history.pattern);
    if (!pattern) return;

    pattern.weight += this.learningRate * feedback;
    pattern.weight = Math.max(0.1, Math.min(2.0, pattern.weight));

    if (feedback > 0 && query) {
      for (const word of query.split(/\s+/)) {
        const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (w && !pattern.trigger.includes(w)) {
          pattern.trigger.push(w);
        }
      }
    }
  }
}

module.exports = { ResponsePatternEngine };
