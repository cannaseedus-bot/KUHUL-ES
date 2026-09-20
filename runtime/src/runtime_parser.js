// runtime/src/runtime_parser.js
//
// AST-based runtime parser for KUHUL-ES.
//
// Uses the compiler's KUHULParser (TypeScript AST) to extract π/τ bindings,
// glyph calls, and simple τ assignment statements. Evaluates expressions with
// the ExpressionEvaluator so variable references, string concatenation, and
// member access work at runtime.

'use strict';

const { KUHULParser } = require('../../compiler/src/parser.js');
const { ExpressionEvaluator } = require('./expression_evaluator');
const ts = require('typescript');

const GLYPH_NAMES = new Set(['Sek', 'Pop', 'Wo', 'Ch\'en', 'Yax', 'Xul', 'Noj']);

class RuntimeParser {
  constructor(source, filename = 'source.kuhules') {
    this.source = source;
    this.filename = filename;
    this.program = new KUHULParser(source, filename).parse();
  }

  // Extract π/τ bindings using AST, evaluate values with full expression support.
  // Mutates the supplied context maps so later bindings can reference earlier ones.
  extractBindings(context) {
    const evaluator = new ExpressionEvaluator(context);
    const bindings = { π: new Map(), τ: new Map() };

    for (const [name, b] of this.program.πBindings) {
      const raw = this._rawSource(b.source, b.position);
      const value = Object.freeze(evaluator.eval(raw));
      bindings.π.set(name, value);
      if (context.π) context.π.set(name, value);
    }

    for (const [name, b] of this.program.τBindings) {
      const raw = this._rawSource(b.source, b.position);
      const value = evaluator.eval(raw);
      bindings.τ.set(name, value);
      if (context.τ) context.τ.set(name, value);
    }

    return bindings;
  }

  // Extract glyph calls, evaluating each argument.
  extractGlyphCalls(context) {
    const evaluator = new ExpressionEvaluator(context);
    const calls = [];

    for (const call of this.program.glyphCalls) {
      if (!GLYPH_NAMES.has(call.glyph)) continue;
      const rawArgs = call.rawArgs || call.args.map(a => String(a));
      const args = rawArgs.map((arg, idx) => {
        // Use raw source if available; fall back to already-parsed value
        const src = typeof arg === 'string' ? arg : String(call.args[idx]);
        try { return evaluator.eval(src); }
        catch {
          // If it does not parse as an expression, return the parsed literal
          return call.args[idx] !== undefined ? call.args[idx] : arg;
        }
      });
      calls.push({ glyph: call.glyph, args, source: call.source, position: call.position });
    }

    return calls;
  }

  // Extract simple τ-update statements between glyph calls.
  // Supports: tauName = expr; tauName += expr; tauName -= expr; etc.
  extractTauUpdates(context) {
    const evaluator = new ExpressionEvaluator(context);
    const updates = [];
    const sourceFile = ts.createSourceFile(this.filename, this.source, ts.ScriptTarget.ESNext, true);

    const visit = (node) => {
      if (ts.isExpressionStatement(node)) {
        const expr = node.expression;
        if (ts.isBinaryExpression(expr)) {
          const op = expr.operatorToken.getText();
          if (ts.isIdentifier(expr.left)) {
            const name = expr.left.text;
            const rhs = evaluator.eval(expr.right.getText());
            updates.push({ name, op, value: rhs, position: node.getStart() });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return updates;
  }

  // Find a function* main() or the first generator and return its body source.
  // Used for advanced interpreters; the simple runtime ignores this.
  mainGenerator() {
    for (const fn of this.program.functions) {
      if (fn.name === 'main' || fn.isGenerator) {
        return fn;
      }
    }
    return null;
  }

  _rawSource(sourceText, position) {
    if (!sourceText) return '';
    // sourceText may include the declaration; strip leading "π/tau/τ name = "
    return sourceText.replace(/^(?:π|τ|pi|tau)\s+[A-Za-z_]\w*\s*=\s*/, '').trim();
  }
}

module.exports = { RuntimeParser, GLYPH_NAMES };
