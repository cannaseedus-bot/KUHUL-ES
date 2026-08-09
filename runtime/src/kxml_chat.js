// runtime/src/kxml_chat.js
//
// JavaScript port of the KXML chat template + stock GGUF adapter.
//
// KXML chat is the declarative chat/tool-call layer that renders to glyph tokens
// (trained-in) or to a llama.cpp-compatible Jinja string (interop).
//
// Provides:
//   - renderKxmlTokens(messages)  -> glyph token ids (when a tokenizer is wired)
//   - toJinja()                   -> Jinja chat_template string
//   - kxmlToMessages(messages, style) -> OpenAI-style messages
//   - renderForGguf(messages, chatTemplate) -> final prompt string (minimal Jinja engine)

'use strict';

const ROLES = {
  system: 'I_EXPLAIN',
  user: 'I_QUESTION',
  human: 'I_QUESTION',
  assistant: 'I_ANSWER',
  tool: 'TOOL_RESULT',
};

const SPECIALS = {
  bos: 'BOS',
  eos: 'EOS',
  turn_sep: 'SEP',
  pad: 'PAD',
};

const TEMPLATE_SPEC = {
  name: 'kxml-chat/v1',
  trained_in: true,
  roles: ROLES,
  specials: SPECIALS,
  tool_call: { open: 'TOOL_CALL', tool_token: 'T_<NAME>', close: 'TOOL_RESULT' },
  reasoning: { open: 'THINK_START', close: 'THINK_END' },
  generation_prompt: 'I_ANSWER',
  renders_via: 'glyph_tokenizer.encode_dialogue / encode_turn / encode_tool_call',
  note: 'KXML chat is trained into the token stream. The .jinja is the llama-compatible interop surface.',
};

function toJinja() {
  return (
    "{{ '<BOS>' }}"
    + "{% for m in messages %}"
    + "{% if m['role'] == 'system' %}{{ '<I_EXPLAIN>' }}"
    + "{% elif m['role'] in ['user', 'human'] %}{{ '<I_QUESTION>' }}"
    + "{% elif m['role'] == 'assistant' %}{{ '<I_ANSWER>' }}"
    + "{% elif m['role'] == 'tool' %}{{ '<TOOL_RESULT>' }}"
    + "{% endif %}"
    + "{% if m.get('tool_call') %}{{ '<TOOL_CALL>' }}{{ '<T_' ~ m['tool_call']['name'] ~ '>' }}"
    + "{{ m['tool_call'].get('args', '') }}{{ '<TOOL_RESULT>' }}"
    + "{% else %}{{ m['content'] }}{% endif %}"
    + "{{ '<SEP>' }}"
    + "{% endfor %}"
    + "{% if add_generation_prompt %}{{ '<I_ANSWER>' }}{% endif %}"
  );
}

function emitTemplate(modelDir) {
  return {
    ...TEMPLATE_SPEC,
    example: {
      messages: [
        { role: 'system', content: 'be concise' },
        { role: 'user', content: 'read config.txt' },
        { role: 'assistant', tool_call: { name: 'Read', args: 'config.txt' } },
        { role: 'tool', content: 'port=8080' },
        { role: 'assistant', content: 'the port is 8080' },
      ],
    },
  };
}

const STOCK_ROLE = {
  system: 'system',
  user: 'user',
  human: 'user',
  assistant: 'assistant',
  tool: 'tool',
};

function argsObj(args) {
  return typeof args === 'object' && args !== null ? args : { input: args };
}

function argsJson(args) {
  return JSON.stringify(argsObj(args));
}

function kxmlToMessages(kxmlMessages, toolStyle = 'inline') {
  const out = [];
  for (const m of kxmlMessages) {
    const role = STOCK_ROLE[m.role || 'assistant'] || 'user';
    const tc = m.tool_call;
    if (tc) {
      if (toolStyle === 'openai') {
        out.push({
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: `call_${out.length}`,
            type: 'function',
            function: { name: tc.name, arguments: argsObj(tc.args || '') },
          }],
        });
      } else {
        out.push({
          role: 'assistant',
          content: `\u003ctool_call\u003e\n${JSON.stringify({ name: tc.name, arguments: argsObj(tc.args || '') })}\n\u003c/tool_call\u003e`,
          tool_call: tc,
        });
      }
      continue;
    }
    if (role === 'tool' && toolStyle !== 'openai') {
      out.push({
        role: 'user',
        content: `\u003ctool_response\u003e\n${m.content || ''}\n\u003c/tool_response\u003e`,
      });
    } else {
      out.push({ role, content: m.content || m.text || '' });
    }
  }
  return out;
}

// ── Minimal Jinja renderer sufficient for KXML chat templates ─────────────
// Tokenizes first, then builds an AST, then evaluates. Handles nested if/for.

function tokenizeJinja(tmpl) {
  const tokens = [];
  let i = 0;
  while (i < tmpl.length) {
    const tagStart = tmpl.indexOf('{%', i);
    const exprStart = tmpl.indexOf('{{', i);
    const next = Math.min(tagStart >= 0 ? tagStart : Infinity, exprStart >= 0 ? exprStart : Infinity);

    if (next === Infinity) {
      if (i < tmpl.length) tokens.push({ type: 'text', value: tmpl.slice(i) });
      break;
    }

    if (next > i) tokens.push({ type: 'text', value: tmpl.slice(i, next) });

    if (next === tagStart) {
      const end = tmpl.indexOf('%}', next);
      if (end < 0) throw new Error('Unclosed tag');
      const raw = tmpl.slice(next + 2, end).trim();
      const words = raw.split(/\s+/);
      const kind = words[0];
      if (kind === 'if') {
        tokens.push({ type: 'if', cond: raw.slice(3).trim() });
      } else if (kind === 'elif') {
        tokens.push({ type: 'elif', cond: raw.slice(5).trim() });
      } else if (kind === 'else') {
        tokens.push({ type: 'else' });
      } else if (kind === 'endif') {
        tokens.push({ type: 'endif' });
      } else if (kind === 'for') {
        const m = raw.match(/^for\s+(\w+)\s+in\s+(.+)$/);
        if (!m) throw new Error(`Bad for: ${raw}`);
        tokens.push({ type: 'for', varName: m[1], iterableExpr: m[2].trim() });
      } else if (kind === 'endfor') {
        tokens.push({ type: 'endfor' });
      } else if (kind === 'set') {
        tokens.push({ type: 'set', expr: raw.slice(4).trim() });
      } else {
        throw new Error(`Unknown tag: ${raw}`);
      }
      i = end + 2;
    } else {
      const end = tmpl.indexOf('}}', next);
      if (end < 0) throw new Error('Unclosed expression');
      tokens.push({ type: 'expr', expr: tmpl.slice(next + 2, end).trim() });
      i = end + 2;
    }
  }
  return tokens;
}

function parseBlock(tokens, startIdx, endKinds) {
  const nodes = [];
  let i = startIdx;
  while (i < tokens.length) {
    const t = tokens[i];
    if (endKinds.includes(t.type)) {
      return { nodes, next: i };
    }
    if (t.type === 'if') {
      const branch = parseIf(tokens, i);
      nodes.push(branch.node);
      i = branch.next;
    } else if (t.type === 'for') {
      const body = parseBlock(tokens, i + 1, ['endfor']);
      nodes.push({ type: 'for', varName: t.varName, iterableExpr: t.iterableExpr, body: body.nodes });
      i = body.next + 1;
    } else if (t.type === 'text' || t.type === 'expr' || t.type === 'set') {
      nodes.push(t);
      i++;
    } else {
      throw new Error(`Unexpected token in block: ${t.type}`);
    }
  }
  if (endKinds.length > 0) throw new Error(`Expected ${endKinds.join('/')} not found`);
  return { nodes, next: i };
}

function parseIf(tokens, startIdx) {
  // startIdx points at the opening 'if'
  const branches = [];
  let i = startIdx;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === 'if' || t.type === 'elif') {
      const body = parseBlock(tokens, i + 1, ['elif', 'else', 'endif']);
      branches.push({ cond: t.cond, body: body.nodes });
      i = body.next;
    } else if (t.type === 'else') {
      const body = parseBlock(tokens, i + 1, ['endif']);
      branches.push({ cond: null, body: body.nodes });
      i = body.next;
    } else if (t.type === 'endif') {
      return { node: { type: 'if', branches }, next: i + 1 };
    } else {
      throw new Error('Expected if/elif/else/endif');
    }
  }
  throw new Error('Missing endif');
}

function parseJinja(tmpl) {
  const tokens = tokenizeJinja(tmpl);
  const { nodes } = parseBlock(tokens, 0, []);
  return nodes;
}

function evalExpr(expr, ctx) {
  expr = expr.trim();
  // string literal
  if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) {
    return expr.slice(1, -1);
  }
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (!isNaN(Number(expr))) return Number(expr);

  // concatenation: a ~ b ~ c
  if (expr.includes('~')) {
    return expr.split('~').map(p => evalExpr(p.trim(), ctx)).join('');
  }

  // function call: m.get('tool_call')
  const callMatch = expr.match(/^(.+?)\.get\((['"])(.*?)\2\)$/);
  if (callMatch) {
    const obj = evalExpr(callMatch[1], ctx);
    return obj != null ? obj[callMatch[3]] : undefined;
  }

  // member/property access: m['role'] or m.role or m.tool_call.name
  const bracket = expr.match(/^(.+?)\[(['"])(.*?)\2\]$/);
  if (bracket) {
    const obj = evalExpr(bracket[1], ctx);
    return obj != null ? obj[bracket[3]] : undefined;
  }
  const dot = expr.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)$/);
  if (dot) {
    let obj = ctx[dot[1]];
    if (obj === undefined) return undefined;
    const parts = dot[2].split('.');
    for (const p of parts) {
      if (obj == null) return undefined;
      obj = obj[p];
    }
    return obj;
  }

  // top-level identifier
  return ctx[expr];
}

function evalCondition(cond, ctx) {
  cond = cond.trim();
  // equality
  const eq = cond.match(/^(.+?)\s*==\s*(['"])(.*?)\2$/);
  if (eq) return evalExpr(eq[1], ctx) === eq[3];
  // membership: x in ['a','b']
  const inn = cond.match(/^(.+?)\s+in\s+\[(.*)\]$/);
  if (inn) {
    const left = evalExpr(inn[1], ctx);
    const list = inn[2].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    return list.includes(left);
  }
  // boolean / value
  return !!evalExpr(cond, ctx);
}

function renderNodes(nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') {
      out += n.value;
    } else if (n.type === 'expr') {
      out += String(evalExpr(n.expr, ctx) ?? '');
    } else if (n.type === 'if') {
      let matched = false;
      for (const branch of n.branches) {
        if (branch.cond === null || (!matched && evalCondition(branch.cond, ctx))) {
          matched = true;
          out += renderNodes(branch.body, ctx);
        }
      }
    } else if (n.type === 'for') {
      const iterable = evalExpr(n.iterableExpr, ctx);
      for (const item of iterable || []) {
        const subCtx = { ...ctx, [n.varName]: item, m: item };
        out += renderNodes(n.body, subCtx);
      }
    } else if (n.type === 'set') {
      // minimal set: var = expr
      const m = n.expr.match(/^(\w+)\s*=\s*(.+)$/);
      if (m) ctx[m[1]] = evalExpr(m[2], ctx);
    }
  }
  return out;
}

function renderJinja(template, env) {
  const nodes = parseJinja(template);
  return renderNodes(nodes, env);
}

function renderForGguf(kxmlMessages, chatTemplate, opts = {}) {
  const messages = kxmlToMessages(kxmlMessages, opts.toolStyle || 'inline');
  const env = {
    messages,
    add_generation_prompt: opts.addGenerationPrompt !== false,
    bos_token: opts.bosToken || '',
    eos_token: opts.eosToken || '',
  };
  return renderJinja(chatTemplate, env);
}

module.exports = {
  ROLES,
  SPECIALS,
  TEMPLATE_SPEC,
  toJinja,
  emitTemplate,
  kxmlToMessages,
  renderForGguf,
  renderJinja,
};
