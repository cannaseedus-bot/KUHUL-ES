// runtime/src/kuhul-e.js
//
// KUHUL-E: a domain-specific response generation engine built on K'UHUL
// semantic folds, attention-weighted research, and learnable response patterns.

'use strict';

const { DomainStack } = require('./domain-stack');
const { ResponsePatternEngine } = require('./response-pattern');
const { FoldEngine } = require('./fold-engine');
const { GLSLTrainer } = require('./trainer');

class KUHULEngine {
  constructor(opts = {}) {
    this.domainStack = new DomainStack();
    this.foldEngine = new FoldEngine(opts.foldOpts);
    this.patternEngine = new ResponsePatternEngine(this.domainStack, {
      foldEngine: this.foldEngine,
      maxDepth: opts.foldOpts?.maxDepth,
      learningRate: opts.learningRate,
    });
    this.trainer = null;

    this.researchPlugins = new Map();
    this.responseCache = new Map();
    this.cacheTTL = opts.cacheTTL || 300000;

    this._initDefaultDomains();
    this._initDefaultPatterns();
  }

  _initDefaultDomains() {
    this.domainStack.registerDomain('tech', {
      name: 'Technical Support',
      description: 'IT support, troubleshooting, solutions',
      glyphs: ['Pop', 'Sek', 'Ch\'en'],
      responsePatterns: ['troubleshoot', 'solution', 'escalate'],
      researchHooks: [
        async (query) => ({ source: 'kb', content: 'Found relevant KB article', confidence: 0.8, type: 'fact' }),
      ],
      attentionWeights: { kb: 0.9, web: 0.6, internal: 0.7 },
    });

    this.domainStack.registerDomain('medical', {
      name: 'Medical Information',
      description: 'Medical information, symptoms, treatments',
      glyphs: ['Wo', 'Sek', 'Ch\'en', 'Xul'],
      responsePatterns: ['symptom', 'treatment', 'diagnosis', 'referral'],
      researchHooks: [
        async (query) => ({ source: 'medical_db', content: 'Medical guideline found', confidence: 0.9, type: 'fact' }),
      ],
      attentionWeights: { medical_db: 0.95, pubmed: 0.85, general: 0.5 },
    });

    this.domainStack.registerDomain('legal', {
      name: 'Legal Information',
      description: 'Legal information, case law, contracts',
      glyphs: ['Yax', 'Sek', 'Ch\'en', 'Xul'],
      responsePatterns: ['case', 'contract', 'precedent', 'statute'],
      researchHooks: [
        async (query) => ({ source: 'case_law', content: 'Relevant case found', confidence: 0.85, type: 'fact' }),
      ],
      attentionWeights: { case_law: 0.9, statutes: 0.8, commentary: 0.6 },
    });

    this.domainStack.registerDomain('creative', {
      name: 'Creative Writing',
      description: 'Creative writing, ideas, inspiration',
      glyphs: ['Pop', 'Sek', 'Xul'],
      responsePatterns: ['story', 'poem', 'idea', 'character'],
      researchHooks: [
        async (query) => ({ source: 'inspiration', content: 'Creative prompt generated', confidence: 0.7, type: 'idea' }),
      ],
      attentionWeights: { inspiration: 0.7, style: 0.8 },
    });
  }

  _initDefaultPatterns() {
    this.patternEngine.registerPattern('troubleshoot', {
      domain: 'tech',
      trigger: ['slow', 'crash', 'error', 'problem', 'bug'],
      template: {
        prefix: 'Let me help you troubleshoot that issue.',
        fallback: 'Can you provide more details about the problem?',
      },
      branches: {
        tech: {
          steps: [
            'Check system resources',
            'Review error logs',
            'Update drivers',
            'Restart service',
          ],
          escalation: 'If issues persist, escalate to Level 2 support',
        },
      },
      weight: 0.85,
    });

    this.patternEngine.registerPattern('symptom', {
      domain: 'medical',
      trigger: ['symptom', 'cold', 'fever', 'pain', 'diagnosis'],
      template: {
        prefix: 'I can help you understand those symptoms.',
        fallback: 'Please consult a healthcare professional for personalized advice.',
      },
      branches: {
        medical: {
          steps: [
            'Review reported symptoms',
            'Compare with common conditions',
            'Highlight red flags',
            'Suggest next steps',
          ],
        },
      },
      weight: 0.9,
    });

    this.patternEngine.registerPattern('poem', {
      domain: 'creative',
      trigger: ['poem', 'write', 'creative', 'story', 'song'],
      template: {
        prefix: 'Here is a creative response for you.',
        fallback: 'Tell me more about the style or theme you want.',
      },
      branches: {
        creative: {
          steps: [
            'Choose a theme',
            'Select a structure',
            'Draft imagery',
            'Polish rhythm',
          ],
        },
      },
      weight: 0.8,
    });

    this.patternEngine.registerPattern('fallback', {
      domain: 'general',
      trigger: [],
      template: {
        prefix: 'I understand. Could you tell me more about that?',
        fallback: 'I\'m not sure about that. Can you rephrase?',
      },
      branches: {},
      weight: 0.5,
      metadata: { fallback: true },
    });
  }

  registerResearch(name, plugin) {
    this.researchPlugins.set(name, plugin);
    return this;
  }

  registerPattern(patternId, config) {
    this.patternEngine.registerPattern(patternId, config);
    return this;
  }

  switchDomain(domainId) {
    return this.domainStack.pushDomain(domainId);
  }

  getCurrentDomain() {
    return this.domainStack.getCurrentDomain();
  }

  getStackDepth() {
    return this.domainStack.getStackDepth();
  }

  async query(input, opts = {}) {
    const domainId = opts.domain || this.domainStack.currentDomain || 'general';
    const context = opts.context || {};
    const researchDepth = opts.researchDepth || 1;

    if (domainId !== this.domainStack.currentDomain) {
      this.domainStack.pushDomain(domainId);
    }

    const cacheKey = `${domainId}:${input}`;
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    const pattern = this.patternEngine.findPattern(input, domainId);
    const doResearch = opts.research !== false && (pattern?.metadata?.research || opts.researchDepth > 0 || this.researchPlugins.size > 0);
    const research = doResearch ? await this._conductResearch(input, domainId, researchDepth) : { results: [] };

    const response = await this.patternEngine.generateResponse(
      pattern || this._getFallbackPattern(),
      { ...context, query: input },
      research,
    );

    const result = {
      response: response.text,
      domain: domainId,
      pattern: pattern?.id || 'fallback',
      research: research.results || [],
      metadata: {
        timestamp: Date.now(),
        stackDepth: this.domainStack.getStackDepth(),
        confidence: this._calculateConfidence(pattern, research),
        tokens: this._countTokens(response.text),
        foldId: response.foldId,
      },
    };

    this._setCache(cacheKey, result);
    return result;
  }

  async _conductResearch(query, domainId, depth) {
    const domain = this.domainStack.getCurrentDomain();
    if (!domain) return { results: [] };

    const allResults = [];
    const domainResearch = await this.domainStack.research(query, domainId);
    allResults.push(...domainResearch.results);

    for (const [name, plugin] of this.researchPlugins) {
      try {
        const result = await plugin(query, { domain: domainId, depth });
        allResults.push({ ...result, source: name });
      } catch (e) {
        // Skip failed plugins.
      }
    }

    const weighted = this.domainStack.applyAttention(allResults, domain.attentionWeights || {});
    const grouped = this._groupResearch(weighted);

    return { results: grouped, depth, domain: domainId };
  }

  _groupResearch(results) {
    const seen = new Set();
    return results.filter((r) => {
      if (seen.has(r.content)) return false;
      seen.add(r.content);
      return true;
    });
  }

  _getFallbackPattern() {
    return this.patternEngine.patterns.get('fallback') || {
      id: 'fallback',
      domain: 'general',
      trigger: [],
      template: {
        prefix: 'I understand. Could you tell me more about that?',
        fallback: 'I\'m not sure about that. Can you rephrase?',
      },
      branches: {},
      weight: 0.5,
      metadata: { fallback: true },
    };
  }

  _calculateConfidence(pattern, research) {
    let confidence = pattern?.weight || 0.5;
    if (research?.results?.length > 0) {
      const avg = research.results.reduce((sum, r) => sum + (r.confidence || 0.5), 0) / research.results.length;
      confidence = (confidence + avg) / 2;
    }
    return Math.min(1, Math.max(0, confidence));
  }

  _countTokens(text) {
    return typeof text === 'string' ? text.split(/\s+/).filter(Boolean).length : 0;
  }

  _getCache(key) {
    const cached = this.responseCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.value;
    }
    return null;
  }

  _setCache(key, value) {
    this.responseCache.set(key, { value, timestamp: Date.now() });
    if (this.responseCache.size > 1000) {
      const first = this.responseCache.keys().next().value;
      this.responseCache.delete(first);
    }
  }

  learn(input, response, feedback) {
    this.patternEngine.learn(response, feedback, input);
    return this;
  }

  toKast() {
    return this.foldEngine.toJSON();
  }

  exportKnowledge() {
    return {
      domains: Array.from(this.domainStack.domains.entries()).map(([id, domain]) => ({
        id,
        name: domain.name,
        description: domain.description,
        patterns: domain.responsePatterns,
        glyphs: domain.glyphs,
      })),
      patterns: Array.from(this.patternEngine.patterns.entries()).map(([id, pattern]) => ({
        id,
        domain: pattern.domain,
        trigger: pattern.trigger,
        weight: pattern.weight,
      })),
      history: this.patternEngine.responseHistory.slice(-100),
      folds: this.foldEngine.toJSON(),
    };
  }

  importKnowledge(kastDocument) {
    if (kastDocument.domains) {
      for (const d of kastDocument.domains) {
        this.domainStack.registerDomain(d.id, {
          name: d.name,
          description: d.description,
          glyphs: d.glyphs,
          responsePatterns: d.patterns,
        });
      }
    }
    if (kastDocument.patterns) {
      for (const p of kastDocument.patterns) {
        this.patternEngine.registerPattern(p.id, {
          domain: p.domain,
          trigger: p.trigger,
          weight: p.weight,
        });
      }
    }
    if (kastDocument.folds) {
      const restored = FoldEngine.fromJSON(kastDocument.folds);
      this.foldEngine = restored;
      this.patternEngine.foldEngine = restored;
    }
    return this;
  }
}

module.exports = { KUHULEngine };
