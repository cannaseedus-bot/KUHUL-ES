// test/core_runtime.test.js — isomorphic core runtime tests
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { KUHULRuntimeCore } = require('../runtime/src/core.js');

describe('KUHULRuntimeCore', () => {
  it('executes π/τ bindings with expression evaluation', async () => {
    const rt = new KUHULRuntimeCore({ delayMs: 0 });
    await rt.execute(`
π task = "finish training";
function* main() {
  yield* Pop('init');
  yield* Sek('log', 'task: ' + task);
  yield* Xul();
}
main();
`);
    assert.equal(rt.π.get('task'), 'finish training');
    assert.equal(rt.frame, 3);
    assert.equal(rt.hashChain.length, 3);
  });

  it('runs Noj thinking engine and emits thoughts', async () => {
    const rt = new KUHULRuntimeCore({ delayMs: 0 });
    await rt.execute(`
function* main() {
  yield* Noj('goal: test', { observe: true });
  yield* Xul();
}
main();
`);
    assert.ok(rt.thinker.thoughts.length > 0);
    assert.ok(rt.hashChain.length >= 2);
  });

  it('records physics history for each glyph', async () => {
    const rt = new KUHULRuntimeCore({ delayMs: 0 });
    await rt.execute(`
function* main() {
  yield* Pop('init');
  yield* Sek('log', 'hello');
  yield* Xul();
}
main();
`);
    assert.equal(rt.physics.history.length, 3);
    assert.ok(rt.physics.history.some(s => s.phase === 'Pop'));
    assert.ok(rt.physics.history.some(s => s.phase === 'Sek'));
    assert.ok(rt.physics.history.some(s => s.phase === 'Xul'));
  });

  it('supports custom glyph overrides', async () => {
    const rt = new KUHULRuntimeCore({
      delayMs: 0,
      glyphOverrides: {
        Sek: async (op) => ({ custom: true, op }),
      },
    });
    await rt.execute(`
function* main() {
  yield* Sek('ping');
  yield* Xul();
}
main();
`);
    assert.equal(rt.frame, 2);
  });
});
