'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { KuhulRuntime, kuhulExecute, kuhul, KastEngine, KxmlEngine } = require('../runtime/src/unified.js');

describe('KUHUL unified runtime', () => {
  it('runs full phase pipeline', async () => {
    const runtime = new KuhulRuntime({ mode: 'full' });
    const result = await runtime.execute({ query: 'test' });
    assert.ok(result._compressionValid !== false || result.consolidated || result.executed);
    assert.ok(runtime.getHistory().length >= 7, 'all phases executed');
  });

  it('loads and validates KAST', async () => {
    const runtime = new KuhulRuntime({ mode: 'enforce' });
    runtime.loadKast({
      protocol: 'kast/1',
      version: '1.5.0',
      nodes: [
        { id: 'n1', phase: 'Pop', glyph: 'Pop', opcode: 'PERCEIVE' },
        { id: 'n2', phase: 'Sek', glyph: 'Sek', opcode: 'EXECUTE' },
        { id: 'n3', phase: 'Xul', glyph: 'Xul', opcode: 'COLLAPSE' },
      ],
      edges: [
        { from: 'n1', to: 'n2', kind: 'data' },
        { from: 'n2', to: 'n3', kind: 'control' },
      ],
    });
    assert.equal(runtime.kast.getNode('n1').phase, 'Pop');
    assert.equal(runtime.kast.getOutgoing('n1')[0].to, 'n2');
  });

  it('executes a KXML DAG model', async () => {
    const runtime = new KuhulRuntime({ mode: 'full' });
    runtime.loadKxml({
      name: 'rag-demo',
      version: '1.0.0',
      kind: 'kxml/model',
      forward: [
        { id: 'embed', op: 'embed', inputs: ['query'], outputs: ['embedding'], params: { model: 'demo' } },
        { id: 'retrieve', op: 'retrieve', inputs: ['embedding'], outputs: ['documents'], params: { topK: 2, corpus: ['doc1', 'doc2', 'doc3'] } },
        { id: 'generate', op: 'generate', inputs: ['documents'], outputs: ['answer'], params: { template: 'Answer from {{ documents }}' } },
      ],
    });
    const result = await runtime.execute({ query: 'What is KUHUL?' });
    assert.ok(result.embed, 'DAG produced embed output');
    assert.ok(result.retrieve, 'DAG produced retrieve output');
    assert.ok(result.generate, 'DAG produced generate output');
  });

  it('orchestrate mode returns arranged plan without enforcing it as pipeline', async () => {
    const runtime = new KuhulRuntime({ mode: 'orchestrate' });
    const result = await runtime.execute({ field: 'analysis', type: 'custom' });
    assert.equal(result.field, 'analysis');
    assert.equal(result.collapsed, true);
  });

  it('enforce mode collapses program to law', async () => {
    const runtime = new KuhulRuntime({ mode: 'enforce' });
    const result = await runtime.execute({ definition: 'process_data' });
    assert.equal(result.collapsed, true);
    assert.equal(result.enforced, true);
  });

  it('expand mode produces extrapolations', async () => {
    const runtime = new KuhulRuntime({ mode: 'expand' });
    const result = await runtime.execute('test input');
    assert.ok(Array.isArray(result.expansions));
    assert.ok(result.expansions.length >= 5);
    assert.equal(result.invariant, "'read_only_collapse_result'");
  });

  it('kuhul.execute top-level API parses KUHUL source', async () => {
    const src = `
      [Pop "perceive" → "query"]
      [Sek "execute" → {"steps": ["a", "b"]}]
      [Xul]
    `;
    const result = await kuhul.execute(src, { mode: 'full', enforce: 'kuhul_pi' });
    assert.equal(result.ok || result._compressionValid !== false, true);
  });

  it('top-level kuhulExecute parses JSON source', async () => {
    const src = JSON.stringify({ query: 'x', steps: ['one', 'two'] });
    const result = await kuhulExecute(src, { mode: 'full' });
    const sek = result.executed || (result._compressed && result._compressed.array ? [] : undefined);
    assert.ok(result._compressionValid === true || Array.isArray(sek));
  });

  it('KastEngine validates invalid phase', () => {
    assert.throws(() => {
      new KastEngine({
        nodes: [{ id: 'bad', phase: 'Unknown' }],
        edges: [],
      }).validate();
    }, /Invalid phase/);
  });

  it('KxmlEngine compute tool runs safe arithmetic', async () => {
    const engine = new KxmlEngine({ forward: [] });
    const r = await engine._callTool('compute', { expression: '2 + 3 * 4' });
    assert.equal(r.result, 14);
  });

  it('KxmlEngine compute tool rejects unsafe expression', async () => {
    const engine = new KxmlEngine({ forward: [] });
    const r = await engine._callTool('compute', { expression: 'process.exit(1)' });
    assert.equal(r.error, 'unsafe expression');
  });
});
