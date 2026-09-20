// runtime/src/domain-stack.mjs
//
// ES module version of the KUHUL-E domain stack manager.

'use strict';

class DomainStack {
  constructor() {
    this.domains = new Map();
    this.activeStack = [];
    this.currentDomain = null;
  }

  registerDomain(domainId, config) {
    this.domains.set(domainId, {
      id: domainId,
      name: config.name,
      description: config.description,
      glyphs: config.glyphs || ['Pop', 'Wo', 'Sek', 'Ch\'en', 'Xul'],
      responsePatterns: config.responsePatterns || [],
      researchHooks: config.researchHooks || [],
      attentionWeights: config.attentionWeights || {},
      fallback: config.fallback || 'general',
    });
    return this;
  }

  pushDomain(domainId) {
    if (!this.domains.has(domainId)) {
      throw new Error(`Domain ${domainId} not registered`);
    }
    this.activeStack.push(domainId);
    this.currentDomain = domainId;
    return this.getCurrentDomain();
  }

  popDomain() {
    this.activeStack.pop();
    this.currentDomain = this.activeStack[this.activeStack.length - 1] || null;
    return this.getCurrentDomain();
  }

  getCurrentDomain() {
    if (!this.currentDomain) return null;
    return this.domains.get(this.currentDomain);
  }

  getStackDepth() {
    return this.activeStack.length;
  }

  async research(query, domainId) {
    const domain = this.domains.get(domainId);
    if (!domain) return { results: [] };

    const results = [];
    for (const hook of domain.researchHooks) {
      const result = await hook(query);
      results.push(result);
    }
    return { results, domain: domainId };
  }

  applyAttention(researchResults, attentionWeights) {
    const weights = attentionWeights || {};
    return researchResults
      .map((r) => ({ ...r, weight: weights[r.source] ?? 0.5 }))
      .sort((a, b) => b.weight - a.weight);
  }
}

export { DomainStack };
