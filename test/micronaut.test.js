'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  Micronaut,
  Fold,
  Field,
  Tool,
  Agent,
  Rule,
  MicronautFactory,
  ToolRegistry,
  FieldRegistry,
  FoldRegistry,
  AgentRegistry,
} = require('../runtime/src/micronaut.js');

function setupRagFold() {
  ToolRegistry.clear?.();
  FoldRegistry.clear?.();

  const embedder = new Tool({
    name: 'embedder',
    execute: (input) => ({ embedding: [0.1, 0.2], text: input.query || input }),
  });
  ToolRegistry.register(embedder.id, embedder);

  const retriever = new Tool({
    name: 'retriever',
    execute: (input) => ({ documents: ['doc1', 'doc2'], embedding: input.embedding }),
  });
  ToolRegistry.register(retriever.id, retriever);

  const fold = new Fold({
    name: 'rag_pipeline',
    type: 'reasoning',
    nodes: [
      { id: 'input', type: 'input' },
      { id: 'embed', type: 'process', config: { tool: embedder.id } },
      { id: 'retrieve', type: 'process', config: { tool: retriever.id } },
      { id: 'generate', type: 'transform', config: { transform: (inputs) => ({ answer: Object.keys(inputs).join(' ') }) } },
      { id: 'output', type: 'output' },
    ],
    edges: [
      { from: 'input', to: 'embed' },
      { from: 'embed', to: 'retrieve' },
      { from: 'retrieve', to: 'generate' },
      { from: 'generate', to: 'output' },
    ],
  });
  FoldRegistry.register(fold.id, fold);

  return { foldId: fold.id, toolIds: [embedder.id, retriever.id] };
}

describe('Micronaut orchestration layer', () => {
  it('creates a Micronaut with identity and policy', () => {
    const m = new Micronaut({ name: 'test-µ', priority: 'balanced' });
    assert.equal(m.identity.name, 'test-µ');
    assert.equal(m.policy.priority, 'balanced');
    assert.equal(m.state.status, 'created');
  });

  it('rejects invalid priority', () => {
    assert.throws(() => new Micronaut({ name: 'x', priority: 'invalid' }), /Invalid priority/);
  });

  it('lifecycle: create and start', async () => {
    const m = new Micronaut({ name: 'lifecycle-µ' });
    await m.create();
    assert.equal(m.state.status, 'initializing');
    await m.start();
    assert.equal(m.state.status, 'running');
    await m.stop();
    assert.equal(m.state.status, 'terminated');
  });

  it('orchestrates a fold through its DAG', async () => {
    const { foldId, toolIds } = setupRagFold();
    const m = new Micronaut({
      name: 'rag-orchestrator',
      orchestrates: [foldId],
      tools: toolIds,
      permissions: ['fold:execute', 'field:read'],
    });
    await m.start();
    const result = await m.orchestrate({ query: 'What is KUHUL?' });
    assert.ok(result.output, 'DAG produced output');
    assert.ok(result.output.value, 'Output node has value');
    await m.stop();
  });

  it('Field stores matrix values', () => {
    const f = new Field({
      name: 'working',
      type: 'working',
      data: { rows: 2, cols: 2, values: [1, 2, 3, 4] },
    });
    assert.deepEqual(f.toMatrix(), [[1, 2], [3, 4]]);
    f.setValue(0, 1, 9);
    assert.equal(f.getValue(0, 1), 9);
  });

  it('Rule evaluates condition and logs action', async () => {
    const r = new Rule({
      name: 'error-rule',
      condition: { field: 'metrics.errors', operator: '>', value: 0 },
      action: { type: 'log', params: { message: 'Error detected' } },
    });
    assert.equal(r.evaluate({ metrics: { errors: 1 } }), true);
    assert.equal(r.evaluate({ metrics: { errors: 0 } }), false);
    const res = await r.execute({ metrics: { errors: 1 } }, { dispatch: () => {}, propagate: () => {} });
    assert.equal(res.logged, true);
  });

  it('Agent executes a sequence of tools', async () => {
    const t1 = new Tool({ name: 'double', execute: (x) => (x * 2) });
    ToolRegistry.register(t1.id, t1);
    const a = new Agent({ name: 'worker', type: 'worker', tools: [t1.id] });
    const res = await a.execute(5);
    assert.equal(res.output, 10);
  });

  it('Factory creates all component types', () => {
    assert.ok(MicronautFactory.createMicronaut({ name: 'x' }) instanceof Micronaut);
    assert.ok(MicronautFactory.createFold({ name: 'y' }) instanceof Fold);
    assert.ok(MicronautFactory.createField({ name: 'z' }) instanceof Field);
    assert.ok(MicronautFactory.createTool({ name: 'w' }) instanceof Tool);
  });

  it('evaluates rules in priority order', async () => {
    const m = new Micronaut({ name: 'rule-µ' });
    m.addRule({ name: 'low', priority: 1, condition: { field: 'x', operator: '==', value: 1 }, action: { type: 'log' } });
    m.addRule({ name: 'high', priority: 10, condition: { field: 'x', operator: '==', value: 1 }, action: { type: 'log' } });
    const fired = await m.evaluateRules({ x: 1 });
    assert.equal(fired.length, 2);
    assert.equal(fired[0].rule, m._rules.find(r => r.name === 'high').id);
  });
});
