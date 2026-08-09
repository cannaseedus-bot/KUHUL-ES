// test/expression_evaluator.test.js — AST-based expression evaluation
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ExpressionEvaluator } = require('../runtime/src/expression_evaluator.js');

describe('ExpressionEvaluator', () => {
  it('evaluates literals', () => {
    const ev = new ExpressionEvaluator();
    assert.equal(ev.eval('42'), 42);
    assert.equal(ev.eval("'hello'"), 'hello');
    assert.equal(ev.eval('true'), true);
    assert.equal(ev.eval('null'), null);
  });

  it('evaluates arithmetic and comparisons', () => {
    const ev = new ExpressionEvaluator();
    assert.equal(ev.eval('2 + 3 * 4'), 14);
    assert.equal(ev.eval('10 > 5'), true);
    assert.equal(ev.eval('1 === 1'), true);
    assert.equal(ev.eval('1 !== 2'), true);
  });

  it('evaluates string concatenation', () => {
    const ev = new ExpressionEvaluator();
    assert.equal(ev.eval("'goal: ' + 'finish'"), 'goal: finish');
  });

  it('resolves π and τ context variables', () => {
    const ev = new ExpressionEvaluator({
      π: new Map([['task', 'training']]),
      τ: new Map([['frame', 7]]),
    });
    assert.equal(ev.eval('task'), 'training');
    assert.equal(ev.eval('frame + 1'), 8);
    assert.equal(ev.eval("'goal: ' + task"), 'goal: training');
  });

  it('evaluates ternary expressions', () => {
    const ev = new ExpressionEvaluator();
    assert.equal(ev.eval('true ? 1 : 0'), 1);
    assert.equal(ev.eval('false ? 1 : 0'), 0);
  });

  it('evaluates Math.* calls', () => {
    const ev = new ExpressionEvaluator();
    assert.equal(ev.eval('Math.sin(0)'), 0);
    assert.equal(ev.eval('Math.max(3, 7)'), 7);
  });

  it('rejects unresolved identifiers', () => {
    const ev = new ExpressionEvaluator();
    assert.throws(() => ev.eval('unknownVar'), /Unresolved identifier/);
  });

  it('rejects assignment operators', () => {
    const ev = new ExpressionEvaluator({ τ: new Map([['x', 1]]) });
    assert.throws(() => ev.eval('x = 2'), /Unsupported/);
  });
});
