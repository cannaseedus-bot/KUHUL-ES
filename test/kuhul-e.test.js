// test/kuhul-e.test.js — KUHUL-E domain-specific response engine tests

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { KUHULEngine } = require('../runtime/src/kuhul-e.js');

describe('KUHUL-E Engine', () => {
  it('switches domains and returns current domain info', () => {
    const engine = new KUHULEngine();
    assert.equal(engine.getCurrentDomain(), null);
    engine.switchDomain('tech');
    assert.equal(engine.getCurrentDomain().id, 'tech');
    engine.switchDomain('medical');
    assert.equal(engine.getStackDepth(), 2);
  });

  it('routes a tech query to the tech domain pattern', async () => {
    const engine = new KUHULEngine();
    const result = await engine.query('My computer is running slow', { domain: 'tech', researchDepth: 1 });
    assert.equal(result.domain, 'tech');
    assert.equal(result.pattern, 'troubleshoot');
    assert.ok(result.response.includes('troubleshoot'));
    assert.ok(result.research.length > 0);
    assert.ok(result.metadata.confidence > 0);
  });

  it('routes a medical query to the medical pattern', async () => {
    const engine = new KUHULEngine();
    const result = await engine.query('What are the symptoms of a cold?', { domain: 'medical' });
    assert.equal(result.domain, 'medical');
    assert.equal(result.pattern, 'symptom');
    assert.ok(result.response.includes('symptoms'));
    assert.ok(result.metadata.tokens > 0);
  });

  it('routes a creative query to the creative pattern', async () => {
    const engine = new KUHULEngine();
    const result = await engine.query('Write a short poem about technology', { domain: 'creative' });
    assert.equal(result.domain, 'creative');
    assert.equal(result.pattern, 'poem');
    assert.ok(result.response.includes('creative'));
  });

  it('falls back to general pattern for unrecognized input', async () => {
    const engine = new KUHULEngine();
    const result = await engine.query('xyz unknown query', { domain: 'tech' });
    assert.equal(result.pattern, 'fallback');
    assert.ok(result.response.includes('?'));
  });

  it('uses research plugins when configured', async () => {
    const engine = new KUHULEngine();
    engine.registerResearch('wikipedia', async (query) => ({
      source: 'wikipedia',
      content: `Wiki article about "${query}"`,
      confidence: 0.7,
      type: 'fact',
    }));
    const result = await engine.query('computer slow', { domain: 'tech', researchDepth: 1 });
    assert.ok(result.research.some((r) => r.source === 'wikipedia'));
  });

  it('caches repeated queries', async () => {
    const engine = new KUHULEngine({ cacheTTL: 60000 });
    const r1 = await engine.query('cache me', { domain: 'tech' });
    const r2 = await engine.query('cache me', { domain: 'tech' });
    assert.equal(r1.response, r2.response);
    assert.equal(r1.metadata.timestamp, r2.metadata.timestamp);
  });

  it('learns from positive feedback and strengthens triggers', async () => {
    const engine = new KUHULEngine();
    const result = await engine.query('computer is running slow', { domain: 'tech' });
    const before = engine.patternEngine.patterns.get('troubleshoot').weight;
    engine.learn('computer is running slow', result.metadata.foldId, 1.0);
    const after = engine.patternEngine.patterns.get('troubleshoot').weight;
    assert.ok(after > before, `weight should increase: ${before} -> ${after}`);
    assert.ok(engine.patternEngine.patterns.get('troubleshoot').trigger.includes('computer'));
  });

  it('exports and re-imports knowledge', async () => {
    const engine = new KUHULEngine();
    await engine.query('computer is running slow', { domain: 'tech' });
    const knowledge = engine.exportKnowledge();
    assert.ok(knowledge.domains.length >= 4);
    assert.ok(knowledge.patterns.some((p) => p.id === 'troubleshoot'));
    assert.equal(knowledge.folds.protocol, 'kfold/1');

    const engine2 = new KUHULEngine();
    engine2.importKnowledge(knowledge);
    assert.ok(engine2.domainStack.domains.has('tech'));
    assert.ok(engine2.patternEngine.patterns.has('troubleshoot'));
  });

  it('toKast returns a kfold/1 graph with response folds', async () => {
    const engine = new KUHULEngine();
    await engine.query('computer is running slow', { domain: 'tech' });
    const kast = engine.toKast();
    assert.equal(kast.protocol, 'kfold/1');
    assert.ok(kast.folds.length > 0);
    assert.ok(kast.folds.every((f) => f.axis === 'vertical' && f.nodes.length > 0));
  });
});
