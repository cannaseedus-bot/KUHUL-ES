// test/runtime_parser.test.js — AST-based runtime parsing
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeParser } = require('../runtime/src/runtime_parser.js');

describe('RuntimeParser', () => {
  it('extracts π and τ bindings with expression evaluation', () => {
    const source = `
π a = 10;
τ b = a + 5;
`;
    const parser = new RuntimeParser(source);
    const ctx = { π: new Map(), τ: new Map(), locals: new Map() };
    const bindings = parser.extractBindings(ctx);

    assert.equal(bindings.π.get('a'), 10);
    assert.equal(bindings.τ.get('b'), 15);
    assert.equal(ctx.π.get('a'), 10);
    assert.equal(ctx.τ.get('b'), 15);
  });

  it('extracts glyph calls and evaluates string-concat arguments', () => {
    const source = `
π task = "training";
function* main() {
  yield* Pop('init');
  yield* Noj('goal: ' + task, { observe: true });
  yield* Sek('log', 'done');
}
main();
`;
    const parser = new RuntimeParser(source);
    const ctx = { π: new Map([['task', 'training']]), τ: new Map(), locals: new Map() };
    const calls = parser.extractGlyphCalls(ctx);

    assert.equal(calls.length, 3);
    assert.equal(calls[0].glyph, 'Pop');
    assert.deepEqual(calls[0].args, ['init']);
    assert.equal(calls[1].glyph, 'Noj');
    assert.equal(calls[1].args[0], 'goal: training');
    assert.deepEqual(calls[1].args[1], { observe: true });
  });

  it('passes numeric and object literals through', () => {
    const source = `
function* main() {
  yield* Sek('wait', 100, [1, 2, 3]);
}
main();
`;
    const parser = new RuntimeParser(source);
    const calls = parser.extractGlyphCalls({ π: new Map(), τ: new Map(), locals: new Map() });

    assert.equal(calls[0].args[0], 'wait');
    assert.equal(calls[0].args[1], 100);
    assert.deepEqual(calls[0].args[2], [1, 2, 3]);
  });
});
