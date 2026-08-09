// runtime/src/runtime_parser.mjs
// Lightweight ESM runtime parser for browser/service worker.
// Uses a simple regex-based extractor plus the lightweight ExpressionEvaluator.

import { ExpressionEvaluator } from './expression_evaluator.mjs';

const GLYPHS = ['Sek','Pop','Wo',"Ch'en","Yax","Xul","Noj"]; 
const GLYPH_RE = /yield\*\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*;/g;
const PI_RE = /\bπ\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;]+);/g;
const TAU_RE = /\bτ\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;]+);/g;

class RuntimeParser {
  constructor(source, filename = 'source.kuhules') {
    this.source = source;
    this.filename = filename;
  }

  extractBindings(ctx = {}) {
    const evaluator = new ExpressionEvaluator(ctx);
    const π = new Map();
    const τ = new Map();

    let m;
    while ((m = PI_RE.exec(this.source)) !== null) {
      const name = m[1];
      const expr = m[2].trim();
      try {
        const val = evaluator.eval(expr);
        π.set(name, val);
        if (ctx.π) ctx.π.set(name, val);
      } catch (e) {
        // fall back to raw string
        π.set(name, expr.replace(/^['"]|['"]$/g, ''));
        if (ctx.π) ctx.π.set(name, expr.replace(/^['"]|['"]$/g, ''));
      }
    }

    while ((m = TAU_RE.exec(this.source)) !== null) {
      const name = m[1];
      const expr = m[2].trim();
      try {
        const val = evaluator.eval(expr);
        τ.set(name, val);
        if (ctx.τ) ctx.τ.set(name, val);
      } catch (e) {
        τ.set(name, expr.replace(/^['"]|['"]$/g, ''));
        if (ctx.τ) ctx.τ.set(name, expr.replace(/^['"]|['"]$/g, ''));
      }
    }

    return { π, τ };
  }

  extractGlyphCalls(ctx = {}) {
    const evaluator = new ExpressionEvaluator(ctx);
    const calls = [];
    let m;

    while ((m = GLYPH_RE.exec(this.source)) !== null) {
      const glyph = m[1];
      if (!GLYPHS.includes(glyph)) continue;
      const rawArgs = m[2].trim();
      const args = rawArgs.length === 0 ? [] : splitArgs(rawArgs).map(a => {
        try { return evaluator.eval(a.trim()); } catch { return tryParseLiteral(a.trim()); }
      });
      calls.push({ glyph, args, source: m[0] });
    }

    return calls;
  }
}

function splitArgs(src) {
  const out = [];
  let cur = '';
  let depth = 0;
  let inStr = false;
  let strChar = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      cur += ch;
      if (ch === strChar && src[i-1] !== '\\') { inStr = false; strChar = null; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strChar = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; cur += ch; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim().length) out.push(cur);
  return out;
}

function tryParseLiteral(s) {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  if (/^[+-]?[0-9]+(\.[0-9]+)?$/.test(t)) return parseFloat(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  try { return JSON.parse(t); } catch { return t; }
}

export { RuntimeParser };
