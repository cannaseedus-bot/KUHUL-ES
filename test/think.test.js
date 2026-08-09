// test/think.test.js — K'UHUL Thinking Engine tests
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { KuhulThinkEngine, DEFAULT_RULES, SemanticPatternReasoner } = require('../runtime/src/think.js');
const { KUHULRuntimeNode } = require('../runtime/src/node.js');

describe('KuhulThinkEngine', () => {
  it('produces a bounded, deterministic thought chain from a goal', async () => {
    const engine = new KuhulThinkEngine({ maxDepth: 4, maxBreadth: 16 });
    const r = await engine.think('goal: finish training');

    assert.equal(r.query, 'goal: finish training');
    assert.ok(r.thoughts.length >= 3, 'should chain through plan, execute, commit');
    assert.ok(r.hash, 'trace hash must exist');
    assert.equal(r.stats.fired > 0, true, 'at least one rule should fire');

    const folds = r.thoughts.map(t => t.fold);
    assert.ok(folds.includes('Yax'), 'plan thought exists');
    assert.ok(folds.includes('Sek'), 'execute thought exists');
    assert.ok(folds.includes('Xul'), 'commit thought exists');
  });

  it('is deterministic: same query yields identical trace', async () => {
    const engine = new KuhulThinkEngine({ maxDepth: 3 });
    const a = await engine.think('goal: test determinism');
    const b = await engine.think('goal: test determinism');
    assert.equal(a.hash, b.hash);
    assert.deepEqual(a.thoughts.map(t => t.proposition), b.thoughts.map(t => t.proposition));
  });

  it('observes physics metrics and warns when entropy is high', async () => {
    const engine = new KuhulThinkEngine();
    engine.learnBelief('metric:entropy=0.42', 'Pop', 0.95, 'physics');
    const r = await engine.think('observe: runtime');

    const warning = r.thoughts.find(t => t.proposition.includes('entropy high'));
    assert.ok(warning, 'should derive an entropy warning');
    assert.equal(warning.fold, 'Ch\'en');
  });

  it('honors maxDepth and maxBreadth bounds', async () => {
    const engine = new KuhulThinkEngine({ maxDepth: 1, maxBreadth: 2 });
    const r = await engine.think('goal: bounded');
    assert.ok(r.thoughts.length <= 2, 'breadth limit respected');
    assert.ok(r.stats.depthReached <= 1, 'depth limit respected');
  });

  it('supports controlled learning of custom rules', async () => {
    const engine = new KuhulThinkEngine();
    const result = engine.learnRule({
      id: 'double-negative',
      when: (b) => b.proposition === 'negate:negate:x',
      then: () => ({ proposition: 'believe: x', fold: 'Wo', confidence: 1.0 }),
    });
    assert.equal(result.ok, true);

    const r = await engine.think('negate:negate:x');
    assert.ok(r.thoughts.some(t => t.proposition === 'believe: x'));
  });

  it('reflect() summarizes beliefs about a topic', () => {
    const engine = new KuhulThinkEngine();
    engine.learnBelief('goal: train model', 'Yax', 0.9);
    engine.learnBelief('goal: validate model', 'Yax', 0.8);
    engine.learnBelief('observation: dataset loaded', 'Pop', 0.95);
    const summary = engine.reflect('model');
    assert.equal(summary.beliefs.length, 2);
    assert.ok(summary.summary.includes('2'));
  });

  it('learnPatternRule captures KAST fold/node propositions', async () => {
    const engine = new KuhulThinkEngine();
    const r1 = await engine.learnPatternRule(
      'fold-participation',
      '^fold:(\\w+) node:(\\w+) op:(\\w+) symbol:(\\w+)$',
      '',
      ([fold, node, op, symbol]) => ({
        proposition: `believe: ${node} participates in ${fold} via ${op} on ${symbol}`,
        fold: fold === 'Xul' ? 'Xul' : 'Wo',
        confidence: 0.9,
      })
    );
    assert.equal(r1.ok, true);

    const r2 = await engine.learnPatternRule(
      'fold-loop',
      '^(fold:\\w+).*\\1',
      '',
      ([fold]) => ({
        proposition: `warn: ${fold} repeats in trace`,
        fold: 'Yax',
        confidence: 0.7,
      })
    );
    assert.equal(r2.ok, true);

    const session = await engine.think('fold:Sek node:n12 op:DISPATCH symbol:log');
    assert.ok(session.thoughts.some(t => t.proposition.includes('n12 participates in Sek')));
  });

  it('pattern backreference detects repeated fold', async () => {
    const engine = new KuhulThinkEngine();
    await engine.learnPatternRule(
      'fold-loop',
      '^(fold:\\w+).*\\1',
      '',
      ([fold]) => ({
        proposition: `warn: ${fold} repeats in trace`,
        fold: 'Yax',
        confidence: 0.7,
      })
    );

    const session = await engine.think('fold:Sek ... fold:Sek');
    assert.ok(session.thoughts.some(t => t.proposition.includes('fold:Sek repeats')));
  });
});

describe('Runtime integration', () => {
  it('executes Noj glyph through the runtime and records thoughts', async () => {
    const rt = new KUHULRuntimeNode();
    const source = `
π task = "finish training";
function* main() {
  yield* Pop('init');
  yield* Noj('goal: finish training', { observe: true });
  yield* Sek('log', 'done');
  yield* Xul();
}
main();
`;
    await rt.execute(source);
    assert.ok(rt.thinker.thoughts.length > 0, 'Noj should produce thoughts');
    assert.ok(rt.hashChain.length >= 4, 'hash chain recorded each glyph');
    assert.ok(rt.physics.history.some(s => s.phase === 'Noj'), 'physics has Noj tick');
  });

  it('executes Sek(\'think\', ...) as an alias for Noj', async () => {
    const rt = new KUHULRuntimeNode();
    const source = `
function* main() {
  yield* Sek('think', 'goal: run diagnostics');
  yield* Xul();
}
main();
`;
    await rt.execute(source);
    assert.ok(rt.thinker.thoughts.length > 0);
  });
});
