'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { FoldEngine } = require('../runtime/src/fold.js');

function makeNode(id, index, glyph, opcode, lane = 'math', operands = []) {
  return { id, index, axis: 'linear', lane, glyph, opcode, operands };
}

function makeFold(id, phase = 'Sek', nodes = [], unfolds = [], parent = null, state = 'collapsed') {
  return { id, phase, axis: 'vertical', state, parent, depth: parent ? 1 : 0, nodes, unfolds, attributes: {} };
}

describe('FoldEngine (TypeScript reference)', () => {
  it('registers and unfolds a simple fold with nodes', () => {
    const fe = new FoldEngine();
    fe.registerFold(makeFold('f1', 'Sek', [
      makeNode('a', 0, 'Sek', 'DATA', 'data'),
      makeNode('b', 1, 'Noj', 'FFN', 'compute'),
    ]));
    const ok = fe.unfold('f1');
    assert.equal(ok, true);
    assert.ok(fe.getFold('f1').nodes.some(n => n.id === 'b'));
    assert.equal(fe.getFold('f1').state, 'unfolded');
  });

  it('collapses a fold after expansion', () => {
    const fe = new FoldEngine();
    fe.registerFold(makeFold('f2', 'Xul', [makeNode('c', 0, 'Xul', 'NOP')]));
    fe.unfold('f2');
    assert.equal(fe.getFold('f2').state, 'unfolded');
    fe.collapse('f2');
    assert.equal(fe.getFold('f2').state, 'collapsed');
  });

  it('materializes nested folds explicitly', () => {
    const fe = new FoldEngine();
    fe.registerFold(makeFold('inner', "Ch'en", [makeNode('inn', 0, "Ch'en", 'COMPUTE')], [], 'outer'));
    fe.registerFold(makeFold('outer', 'Sek', [makeNode('out', 0, 'Sek', 'DATA')], [{ target: 'inner', gate: 'dependency' }]));
    fe.unfold('outer');
    assert.equal(fe.getFold('outer').state, 'unfolded');
    assert.equal(fe.getFold('inner').state, 'collapsed');
    fe.admit('inner', 'dependency');
    assert.equal(fe.getFold('inner').state, 'unfolded');
    assert.ok(fe.getFold('inner').nodes.some(n => n.id === 'inn'));
  });

  it('emits fold:expanded and nodes:revealed events', () => {
    const fe = new FoldEngine();
    let expanded = null;
    let revealed = null;
    fe.on('fold:expanded', (ev) => { expanded = ev; });
    fe.on('nodes:revealed', (ev) => { revealed = ev; });
    fe.registerFold(makeFold('e1', 'Sek', [makeNode('n1', 0, 'Sek', 'DATA')]));
    fe.unfold('e1', 'test');
    assert.equal(expanded.foldId, 'e1');
    assert.equal(expanded.gate, 'explicit');
    assert.equal(revealed.fold.id, 'e1');
    assert.equal(revealed.nodes.length, 1);
  });

  it('executes a function over an expanded fold', () => {
    const fe = new FoldEngine();
    fe.registerFold(makeFold('x1', 'Sek', [makeNode('n1', 0, 'Sek', 'MUL', 'math', [2, 3])]));
    fe.unfold('x1');
    const result = fe.exec('x1', (nodes) => {
      const op = nodes[0];
      return op.operands[0] * op.operands[1];
    });
    assert.equal(result, 6);
  });

  it('runs async latent work and drains the queue', async () => {
    const fe = new FoldEngine();
    fe.registerFold(makeFold('l1', 'Sek', [makeNode('n1', 0, 'Sek', 'DATA')]));
    let called = false;
    fe.runAsync('l1', async () => { called = true; });
    await fe.drainLatent('l1');
    assert.equal(called, true);
  });

  it('serializes to kfold/1 and round-trips', () => {
    const fe = new FoldEngine();
    fe.registerFold(makeFold('k1', 'Sek', [makeNode('n1', 0, 'Sek', 'DATA')], [{ target: 'k2', gate: 'always' }]));
    fe.registerFold(makeFold('k2', 'Wo', [makeNode('n2', 0, 'Wo', 'DATA')], [], 'k1'));
    fe.unfold('k1');
    const json = fe.toJSON();
    assert.equal(json.protocol, 'kfold/1');
    assert.equal(json.entry_fold, 'k1');
    assert.equal(json.folds.length, 2);
    const restored = FoldEngine.fromJSON(json);
    assert.equal(restored.getFold('k1').state, 'unfolded');
    assert.equal(restored.getFold('k2').state, 'collapsed');
  });

  it('exports a KAST graph with vertical folds and linear nodes', () => {
    const fe = new FoldEngine();
    fe.registerFold(makeFold('g1', 'Sek', [
      makeNode('a', 0, 'Sek', 'DIV', 'math', ['G*m1*m2', 'r*r']),
      makeNode('b', 1, 'Sek', 'MUL', 'math', ['inverse_square', 'direction']),
    ], [{ target: 'g2', gate: 'dependency', condition: 'orbit_required' }]));
    fe.registerFold(makeFold('g2', 'Sek', [makeNode('c', 0, 'Sek', 'SQRT', 'math', ['G*M/r'])], [], 'g1'));
    const kast = fe.toKast();
    assert.equal(kast.protocol, 'kast/1');
    assert.ok(kast.nodes.some(n => n.id === 'g1' && n.opcode === 'FOLD'));
    assert.ok(kast.edges.some(e => e.type === 'unfold' && e.to === 'g2'));
    assert.ok(kast.edges.some(e => e.type === 'next' && e.from === 'a' && e.to === 'b'));
  });

  it('collects status', () => {
    const fe = new FoldEngine();
    fe.registerFold(makeFold('s1', 'Pop', []));
    fe.unfold('s1');
    const status = fe.status();
    assert.equal(typeof status.entropy, 'number');
    assert.equal(status.folds, 1);
    assert.equal(status.expanded, 1);
  });
});
