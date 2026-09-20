// runtime/src/chat_bridge.js
//
// Node / CommonJS chat-completion bridge for KUHUL-ES.
//
// Routes OpenAI-style chat-completion requests through the local semantic
// engine (KuhulThinkEngine + SemanticPatternReasoner) and renders assistant
// responses with KXML / Jinja chat templates. Supports tool-aware turns.

'use strict';

const { KuhulThinkEngine, SemanticPatternReasoner } = require('./think.js');
const { kxmlToMessages, renderForGguf, toJinja } = require('./kxml_chat.js');

const DEFAULT_TOOLS = [];
const MAX_TOKENS_EST = 64;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lastUserGoal(messages) {
  let blocked = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'tool') {
      blocked = true;
    } else if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      blocked = true;
    } else if ((m.role === 'user' || m.role === 'human') && !blocked) {
      return m.content || m.text || '';
    }
  }
  return '';
}

function kxmlMessagesFromOpenAi(messages) {
  const out = [];
  for (const m of messages || []) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      for (const tc of m.tool_calls) {
        const fn = tc.function || {};
        out.push({
          role: 'assistant',
          tool_call: { name: fn.name || tc.name, args: fn.arguments || tc.arguments || '{}' },
        });
      }
      continue;
    }
    if (m.role === 'tool') {
      out.push({ role: 'tool', content: m.content || '' });
      continue;
    }
    out.push({ role: m.role, content: m.content || m.text || '' });
  }
  return out;
}

function toolResponseFromOpenAi(toolMessages) {
  return (toolMessages || []).map(m => ({ role: 'tool', content: m.content || '' }));
}

class ChatBridge {
  constructor(opts = {}) {
    this.reasoner = opts.reasoner || new SemanticPatternReasoner({ timeoutMs: opts.timeoutMs ?? 500 });
    this.thinker = opts.thinker || new KuhulThinkEngine({ patternReasoner: this.reasoner });
    this.chatTemplate = opts.chatTemplate || toJinja();
    this.tools = opts.tools || DEFAULT_TOOLS;
    this.addGenerationPrompt = opts.addGenerationPrompt !== false;
    this.lastTrace = null;
  }

  setTools(tools) {
    this.tools = tools || [];
  }

  buildPrompt(messages, opts = {}) {
    const kxml = kxmlMessagesFromOpenAi(messages);
    const toolStyle = opts.toolStyle || 'inline';
    const addGen = opts.addGenerationPrompt ?? this.addGenerationPrompt;
    return renderForGguf(kxml, this.chatTemplate, { toolStyle, addGenerationPrompt: addGen });
  }

  matchTool(userText, tools) {
    if (!tools || !tools.length) return null;
    for (const tool of tools) {
      const fn = tool.function || tool;
      const name = fn.name || tool.name;
      const desc = fn.description || tool.description || '';
      const keywords = [name, desc.split(/\s+/).slice(0, 8).join(' ')];
      const pattern = new RegExp(`(^|[^\\w])(${escapeRegExp(name)}|${keywords.slice(1).map(escapeRegExp).join('|')})`, 'iu');
      if (this.reasoner.test(userText, pattern)) {
        const args = this._extractArgs(userText, fn.parameters) || {};
        return {
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          type: 'function',
          function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
        };
      }
    }
    return null;
  }

  _extractArgs(text, parameters) {
    const m = text.match(/[:\s]+(.+)$/);
    if (!m) return {};
    let payload = m[1].trim();
    if ((payload.startsWith('{') && payload.endsWith('}')) || (payload.startsWith('[') && payload.endsWith(']'))) {
      try { return JSON.parse(payload); } catch { return { input: payload }; }
    }
    const props = (parameters && parameters.properties) ? Object.keys(parameters.properties) : [];
    if (props.length === 1) return { [props[0]]: payload };
    return { input: payload };
  }

  async complete(request) {
    const messages = request.messages || [];
    const prompt = this.buildPrompt(messages, { addGenerationPrompt: true });
    const goal = lastUserGoal(messages);

    const trace = [];
    trace.push({ id: 'build-prompt', phase: 'Pop', glyph: 'G_EMBED', prompt });

    const thinkResult = goal ? await this.thinker.think(`goal: ${goal}`) : { thoughts: [] };
    trace.push({ id: 'think', phase: 'Wo', glyph: 'G_LAYERNORM', thoughts: thinkResult.thoughts.slice(0, this.thinker.maxDepth) });
    const thoughts = thinkResult.thoughts;

    let toolCall = null;
    if (this.tools.length && goal) {
      toolCall = this.matchTool(goal, this.tools);
      trace.push({ id: 'match-tool', phase: 'Sek', glyph: 'G_MATMUL', matched: !!toolCall });
    }

    let content = '';
    let finishReason = 'stop';
    if (toolCall) {
      finishReason = 'tool_calls';
      trace.push({ id: 'tool-call', phase: 'Yax', glyph: 'G_ATTENTION', tool_call: toolCall });
    } else {
      const summary = thoughts.map(t => t.proposition).join('; ');
      content = `[think: ${summary || 'none'}]\n${this._generateContent(goal, prompt)}`;
      trace.push({ id: 'respond', phase: 'Xul', glyph: 'G_GELU', content });
    }

    this.lastTrace = trace;

    const response = {
      id: `kuhul-chat-${Math.random().toString(36).slice(2, 10)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model || 'kuhul-es-semantic',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: toolCall ? '' : content,
          ...(toolCall ? { tool_calls: [toolCall] } : {}),
        },
        finish_reason: finishReason,
      }],
      usage: {
        prompt_tokens: prompt.length / 4,
        completion_tokens: (toolCall ? JSON.stringify(toolCall) : content).length / 4,
        total_tokens: 0,
      },
    };
    response.usage.total_tokens = response.usage.prompt_tokens + response.usage.completion_tokens;
    return response;
  }

  _generateContent(goal, prompt) {
    return `Understood. I will reason about "${goal || 'your message'}" using the KXML template (${prompt.length} chars).`;
  }

  toKast() {
    const folds = [];
    let parent = null;
    const phases = { 'build-prompt': 'Pop', think: 'Wo', 'match-tool': 'Sek', 'tool-call': 'Yax', respond: 'Xul' };
    for (let i = 0; i < (this.lastTrace || []).length; i++) {
      const step = this.lastTrace[i];
      const phase = phases[step.id] || 'Sek';
      const id = `fold-${i}-${phase}`;
      folds.push({
        id,
        phase,
        axis: 'vertical',
        state: 'committed',
        parent,
        depth: i,
        nodes: [{
          id: step.id,
          index: 0,
          axis: 'linear',
          lane: 'chat',
          glyph: step.glyph,
          opcode: step.glyph.replace('G_', ''),
          symbol: step.id,
          operands: [],
          attributes: { ...step, trace_index: i },
        }],
        unfolds: [],
        attributes: {},
      });
      parent = id;
    }
    return {
      protocol: 'kfold/1',
      entry_fold: folds.length ? folds[0].id : null,
      folds,
      semantic_hash: null,
    };
  }
}

module.exports = {
  ChatBridge,
  kxmlMessagesFromOpenAi,
  toolResponseFromOpenAi,
};
