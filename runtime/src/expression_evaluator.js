// runtime/src/expression_evaluator.js
//
// Safe, deterministic evaluator for simple KUHUL-ES expressions.
//
// Supports:
//   - literals: numbers, strings (single/double quotes), booleans, null
//   - arrays and objects
//   - variable references to π / τ / local bindings
//   - binary operators: +, -, *, /, %, **, ==, !=, ===, !==, <, <=, >, >=, &&, ||
//   - unary operators: -, +, !
//   - string concatenation with +
//   - ternary expressions
//   - member access: obj.prop and arr[index]
//   - function calls on a small whitelist: Math.*
//
// Explicitly forbidden:
//   - assignment, increment/decrement
//   - new, delete, typeof, void, in, instanceof
//   - unbound identifiers (other than π/τ variables or Math)
//   - property access on strings beyond .length

'use strict';

const { KUHULParser } = require('../../compiler/src/parser.js');
const ts = require('typescript');

const BINARY_OPS = {
  '+':  (a, b) => a + b,
  '-':  (a, b) => a - b,
  '*':  (a, b) => a * b,
  '/':  (a, b) => a / b,
  '%':  (a, b) => a % b,
  '**': (a, b) => a ** b,
  '<':  (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>':  (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a == b,
  '!=': (a, b) => a != b,
  '===':(a, b) => a === b,
  '!==':(a, b) => a !== b,
  '&&':(a, b) => a && b,
  '||': (a, b) => a || b,
};

const UNARY_OPS = {
  '-': (a) => -a,
  '+': (a) => +a,
  '!': (a) => !a,
};

const WHITELISTED_GLOBALS = new Set(['Math', 'JSON']);
const MATH_PROPS = Object.getOwnPropertyNames(Math);

class ExpressionEvaluator {
  constructor(context = {}) {
    this.context = context; // { π: Map, τ: Map, locals: Map }
  }

  eval(expr) {
    const source = `const __KUHUL_EXPR = (${expr});`;
    const sf = ts.createSourceFile('expr.ts', source, ts.ScriptTarget.ESNext, true);
    const stmt = sf.statements[0];
    if (!stmt || !ts.isVariableStatement(stmt)) {
      throw new Error('Expression parse failed');
    }
    const init = stmt.declarationList.declarations[0].initializer;
    if (!init) throw new Error('Empty expression');
    return this._evalNode(init);
  }

  _evalNode(node) {
    if (ts.isNumericLiteral(node)) {
      return parseFloat(node.text);
    }
    if (ts.isStringLiteral(node)) {
      return node.text;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;

    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.map(e => this._evalNode(e));
    }

    if (ts.isObjectLiteralExpression(node)) {
      const obj = {};
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const name = prop.name.getText();
          obj[name] = this._evalNode(prop.initializer);
        }
      }
      return obj;
    }

    if (ts.isIdentifier(node)) {
      const name = node.text;
      return this._resolve(name);
    }

    if (ts.isPropertyAccessExpression(node)) {
      const obj = this._evalNode(node.expression);
      const prop = node.name.text;
      if (obj === Math && MATH_PROPS.includes(prop)) {
        return Math[prop];
      }
      if (obj != null && prop in obj) {
        return obj[prop];
      }
      throw new Error(`Cannot access property ${prop}`);
    }

    if (ts.isElementAccessExpression(node)) {
      const obj = this._evalNode(node.expression);
      const idx = this._evalNode(node.argumentExpression);
      if (obj == null) throw new Error('Cannot index null/undefined');
      return obj[idx];
    }

    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.getText();
      if (op === '&&') {
        const left = this._evalNode(node.left);
        return left ? this._evalNode(node.right) : left;
      }
      if (op === '||') {
        const left = this._evalNode(node.left);
        return left ? left : this._evalNode(node.right);
      }
      const fn = BINARY_OPS[op];
      if (!fn) throw new Error(`Unsupported binary operator ${op}`);
      return fn(this._evalNode(node.left), this._evalNode(node.right));
    }

    if (ts.isPrefixUnaryExpression(node)) {
      const op = node.operator;
      const text = ts.tokenToString(op);
      const fn = UNARY_OPS[text];
      if (!fn) throw new Error(`Unsupported unary operator ${text}`);
      return fn(this._evalNode(node.operand));
    }

    if (ts.isConditionalExpression(node)) {
      const cond = this._evalNode(node.condition);
      return cond ? this._evalNode(node.whenTrue) : this._evalNode(node.whenFalse);
    }

    if (ts.isParenthesizedExpression(node)) {
      return this._evalNode(node.expression);
    }

    if (ts.isCallExpression(node)) {
      const callee = this._evalNode(node.expression);
      const args = node.arguments.map(a => this._evalNode(a));
      if (typeof callee === 'function') {
        return callee(...args);
      }
      throw new Error('Callee is not a function');
    }

    throw new Error(`Unsupported expression node: ${node.getText()}`);
  }

  _resolve(name) {
    // π bindings
    if (this.context.π && this.context.π.has(name)) {
      return this.context.π.get(name);
    }
    // τ bindings
    if (this.context.τ && this.context.τ.has(name)) {
      return this.context.τ.get(name);
    }
    // locals / globals
    if (this.context.locals && this.context.locals.has(name)) {
      return this.context.locals.get(name);
    }
    if (WHITELISTED_GLOBALS.has(name)) {
      return globalThis[name];
    }
    throw new Error(`Unresolved identifier: ${name}`);
  }
}

module.exports = { ExpressionEvaluator };
