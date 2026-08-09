// runtime/src/expression_evaluator.mjs
// Lightweight, browser-safe expression evaluator used by the ESM runtime parser.

const FORBIDDEN = /\b(require|process|module|global|window|eval|Function|constructor|import|export|await|async|new|delete|postMessage)\b/;
const WHITELISTED_GLOBALS = { Math, JSON };

class ExpressionEvaluator {
  constructor(context = {}) {
    // context: { π: Map, τ: Map, locals: Map }
    this.context = context;
  }

  eval(expr) {
    if (typeof expr !== 'string') return expr;
    const s = expr.trim();
    if (!s) return '';
    if (FORBIDDEN.test(s)) {
      throw new Error('Expression contains forbidden tokens');
    }

    // Merge context maps into a plain object for function args
    const scope = Object.create(null);
    if (this.context.π) for (const [k, v] of this.context.π) if (isIdentifier(k)) scope[k] = v;
    if (this.context.τ) for (const [k, v] of this.context.τ) if (isIdentifier(k)) scope[k] = v;
    if (this.context.locals) for (const [k, v] of this.context.locals) if (isIdentifier(k)) scope[k] = v;

    const argNames = Object.keys(scope);
    const argVals = argNames.map(k => scope[k]);

    // Create a function with the scope variables as parameters and Math/JSON whitelisted
    try {
      const fn = new Function(...argNames, 'Math', 'JSON', `"use strict"; return (${s});`);
      return fn(...argVals, WHITELISTED_GLOBALS.Math, WHITELISTED_GLOBALS.JSON);
    } catch (err) {
      // Try a relaxed fallback: treat as a string literal if it looks like one
      const lit = tryParseLiteral(s);
      if (lit !== null) return lit;
      throw new Error(`Expression eval error: ${err.message}`);
    }
  }
}

function isIdentifier(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
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
    // Try JSON parse for arrays/objects (requires double quotes)
    return JSON.parse(t);
  } catch { return null; }
}

export { ExpressionEvaluator };
