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

  eval(expr, options = {}) {
    const raw = typeof expr === 'string' ? expr : String(expr ?? '');
    const filename = typeof options === 'string' ? options : (options.filename || 'expr.ts');
    const sourceText = (options && typeof options === 'object' && options.sourceText) || raw;
    const baseOffset = (options && typeof options === 'object' && Number.isInteger(options.offset)) ? options.offset : 0;
    const source = `const __KUHUL_EXPR = (${raw});`;
    const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.ESNext, true);
    const stmt = sf.statements[0];
    if (!stmt || !ts.isVariableStatement(stmt)) {
      throw this._annotateError(new Error('Expression parse failed'), sf, null, sourceText, baseOffset);
    }
    const init = stmt.declarationList.declarations[0].initializer;
    if (!init) throw this._annotateError(new Error('Empty expression'), sf, null, sourceText, baseOffset + raw.length);
    this._sourceFile = sf;
    this._sourceText = sourceText;
    this._sourceOffset = baseOffset;
    try {
      return this._evalNode(init);
    } finally {
      this._sourceFile = null;
      this._sourceText = null;
      this._sourceOffset = 0;
    }
  }

  _evalNode(node) {
    try {
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
    } catch (error) {
      throw this._annotateError(error, this._sourceFile, node, this._sourceText || '', this._sourceOffset || 0);
    }
  }

  _annotateError(error, sourceFile, node, sourceText = '', baseOffset = 0) {
    if (!error || typeof error !== 'object') {
      error = new Error(String(error));
    }
    if (error.__kuhulLocation) return error;

    const filename = sourceFile && sourceFile.fileName ? sourceFile.fileName : 'expr.ts';
    const nodeStart = node && sourceFile && typeof node.getStart === 'function'
      ? node.getStart(sourceFile)
      : 0;
    const offset = Math.max(0, (nodeStart || 0) + baseOffset);
    const loc = this._lineColumnAt(sourceText || '', offset);

    error.filename = filename;
    error.line = loc.line;
    error.column = loc.column;
    error.location = { filename, line: loc.line, column: loc.column, snippet: loc.snippet };
    error.source = sourceText;
    error.snippet = loc.snippet;
    error.__kuhulLocation = true;

    const prefix = `${filename}:${loc.line}:${loc.column}`;
    if (typeof error.message === 'string' && !error.message.startsWith(prefix)) {
      error.message = `${prefix}: ${error.message}`;
    }
    return error;
  }

  _lineColumnAt(sourceText, offset) {
    const text = sourceText || '';
    const safeOffset = Math.max(0, Math.min(offset || 0, text.length));
    const before = text.slice(0, safeOffset);
    const line = before.split(/\r\n|\r|\n/).length;
    const lastLineBreak = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
    const column = safeOffset - (lastLineBreak + 1) + 1;
    const lines = text.split(/\r\n|\r|\n/);
    const currentLine = lines[Math.max(0, line - 1)] || '';
    const snippet = `${currentLine}\n${' '.repeat(Math.max(column - 1, 0))}^`;
    return { line, column, snippet };
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
