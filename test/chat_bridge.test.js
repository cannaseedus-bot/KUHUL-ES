// test/chat_bridge.test.js — chat-completion bridge tests

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ChatBridge } = require('../runtime/src/chat_bridge.js');

const weatherTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Return the current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
};

describe('ChatBridge', () => {
  it('renders an OpenAI chat request into a KXML/Jinja prompt', () => {
    const bridge = new ChatBridge();
    const prompt = bridge.buildPrompt([
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'hello' },
    ]);
    assert.match(prompt, /I_EXPLAIN/);
    assert.match(prompt, /I_QUESTION/);
    assert.match(prompt, /I_ANSWER/);
  });

  it('returns a deterministic semantic completion with reasoning', async () => {
    const bridge = new ChatBridge();
    const response = await bridge.complete({
      model: 'kuhul-es',
      messages: [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'explain gravity' },
      ],
    });
    assert.equal(response.object, 'chat.completion');
    assert.equal(response.choices.length, 1);
    assert.equal(response.choices[0].message.role, 'assistant');
    assert.equal(response.choices[0].finish_reason, 'stop');
    assert.ok(response.choices[0].message.content.includes('think:'));
    assert.ok(response.usage.total_tokens > 0);
  });

  it('detects a tool call from the user message', async () => {
    const bridge = new ChatBridge({ tools: [weatherTool] });
    const response = await bridge.complete({
      model: 'kuhul-es',
      messages: [
        { role: 'user', content: 'get_weather London' },
      ],
    });
    assert.equal(response.choices[0].finish_reason, 'tool_calls');
    assert.ok(Array.isArray(response.choices[0].message.tool_calls));
    assert.equal(response.choices[0].message.tool_calls[0].function.name, 'get_weather');
    const args = JSON.parse(response.choices[0].message.tool_calls[0].function.arguments);
    assert.equal(args.city, 'London');
  });

  it('round-trips assistant tool_calls and tool results', async () => {
    const bridge = new ChatBridge({ tools: [weatherTool] });
    const r1 = await bridge.complete({
      model: 'kuhul-es',
      messages: [{ role: 'user', content: 'get_weather Tokyo' }],
    });
    const tc = r1.choices[0].message.tool_calls[0];
    const r2 = await bridge.complete({
      model: 'kuhul-es',
      messages: [
        { role: 'user', content: 'get_weather Tokyo' },
        { role: 'assistant', tool_calls: [tc] },
        { role: 'tool', content: 'sunny 25C', tool_call_id: tc.id },
      ],
    });
    assert.equal(r2.choices[0].finish_reason, 'stop');
    assert.ok(r2.choices[0].message.content.includes('sunny 25C') || r2.choices[0].message.content.includes('think:'));
  });

  it('exports a kfold/1 trace after completion', async () => {
    const bridge = new ChatBridge();
    await bridge.complete({
      model: 'kuhul-es',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const kast = bridge.toKast();
    assert.equal(kast.protocol, 'kfold/1');
    assert.ok(kast.entry_fold);
    assert.ok(kast.folds.length >= 2);
    assert.ok(kast.folds.some(f => f.phase === 'Pop'));
    assert.ok(kast.folds.some(f => f.phase === 'Wo'));
    for (const f of kast.folds) {
      assert.equal(f.axis, 'vertical');
      assert.ok(f.nodes.length > 0);
      assert.equal(f.nodes[0].axis, 'linear');
    }
  });
});
