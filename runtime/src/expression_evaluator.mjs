// runtime/src/expression_evaluator.mjs
// Lightweight, browser-safe expression evaluator used by the ESM runtime parser.

const FORBIDDEN = /\b(require|process|module|global|window|eval|Function|constructor|import|export|await|async|new|delete|postMessage)\b/;
const WHITELISTED_GLOBALS = { Math, JSON };

class ExpressionEvaluator {
  constructor(context = {}) {
    // context: { π: Map, τ: Map, locals: Map }
    this.context = context;
  }

  eval(expr, options = {}) {
    const raw = typeof expr === 'string' ? expr : String(expr ?? '');
    const sourceText = (options && typeof options === 'object' && options.sourceText) || raw;
    const baseOffset = (options && typeof options === 'object' && Number.isInteger(options.offset)) ? options.offset : 0;
    const filename = (options && typeof options === 'object' && options.filename) || 'expr.ts';
    const s = raw.trim();
    if (!s) return '';
    if (FORBIDDEN.test(s)) {
      throw this._annotateError(new Error('Expression contains forbidden tokens'), filename, sourceText, baseOffset + 0);
    }

    const scope = Object.create(null);
    if (this.context.π) for (const [k, v] of this.context.π) if (isIdentifier(k)) scope[k] = v;
    if (this.context.τ) for (const [k, v] of this.context.τ) if (isIdentifier(k)) scope[k] = v;
    if (this.context.locals) for (const [k, v] of this.context.locals) if (isIdentifier(k)) scope[k] = v;

    const argNames = Object.keys(scope);
    const argVals = argNames.map(k => scope[k]);

    try {
      const fn = new Function(...argNames, 'Math', 'JSON', `"use strict"; return (${s});`);
      return fn(...argVals, WHITELISTED_GLOBALS.Math, WHITELISTED_GLOBALS.JSON);
    } catch (err) {
      const lit = tryParseLiteral(s);
      if (lit !== null) return lit;
      throw this._annotateError(new Error(`Expression eval error: ${err.message}`), filename, sourceText, baseOffset + s.length);
    }
  }

  _annotateError(error, filename, sourceText = '', offset = 0) {
    if (!error || typeof error !== 'object') error = new Error(String(error));
    if (error.__kuhulLocation) return error;
    const loc = lineColumnAt(sourceText, offset);
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
}

function isIdentifier(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function lineColumnAt(sourceText, offset) {
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

function tryParseLiteral(src) {
  const t = src.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  if (/^[+-]?[0-9]+(\.[0-9]+)?$/.test(t)) return parseFloat(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  try {
    return JSON.parse(t);
  } catch { return null; }
}

export { ExpressionEvaluator };
