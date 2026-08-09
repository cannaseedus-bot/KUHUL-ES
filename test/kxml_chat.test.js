// test/kxml_chat.test.js — KXML chat template + stock adapter tests
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toJinja, emitTemplate, kxmlToMessages, renderForGguf, renderJinja } = require('../runtime/src/kxml_chat.js');

describe('KXML chat', () => {
  it('produces a Jinja template string', () => {
    const jinja = toJinja();
    assert.ok(jinja.includes('{% for m in messages %}'));
    assert.ok(jinja.includes('<BOS>'));
    assert.ok(jinja.includes('<I_ANSWER>'));
  });

  it('emits a template spec with example messages', () => {
    const spec = emitTemplate('/tmp');
    assert.equal(spec.name, 'kxml-chat/v1');
    assert.ok(Array.isArray(spec.example.messages));
  });

  it('converts KXML messages to stock inline messages', () => {
    const messages = [
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'read config.txt' },
      { role: 'assistant', tool_call: { name: 'Read', args: 'config.txt' } },
      { role: 'tool', content: 'port=8080' },
      { role: 'assistant', content: 'port is 8080' },
    ];
    const out = kxmlToMessages(messages, 'inline');
    assert.equal(out[0].role, 'system');
    assert.equal(out[2].role, 'assistant');
    assert.ok(out[2].content.includes('tool_call'));
    assert.ok(out[3].content.includes('tool_response'));
  });

  it('converts KXML messages to OpenAI-style tool calls', () => {
    const messages = [
      { role: 'assistant', tool_call: { name: 'Read', args: { path: 'config.txt' } } },
    ];
    const out = kxmlToMessages(messages, 'openai');
    assert.equal(out[0].tool_calls[0].function.name, 'Read');
    assert.deepEqual(out[0].tool_calls[0].function.arguments, { path: 'config.txt' });
  });

  it('renders a simple Jinja template', () => {
    const tmpl = "{{ '<BOS>' }}{% for m in messages %}{{ m['role'] }}:{{ m['content'] }}<SEP>{% endfor %}";
    const prompt = renderJinja(tmpl, {
      messages: [
        { role: 'system', content: 'hi' },
        { role: 'user', content: 'hello' },
      ],
    });
    assert.ok(prompt.includes('<BOS>'));
    assert.ok(prompt.includes('system:hi<SEP>'));
    assert.ok(prompt.includes('user:hello<SEP>'));
  });

  it('renders KXML chat via the stock adapter', () => {
    const chatTemplate = toJinja();
    const messages = [
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'read config.txt' },
      { role: 'assistant', tool_call: { name: 'Read', args: 'config.txt' } },
      { role: 'tool', content: 'port=8080' },
    ];
    const prompt = renderForGguf(messages, chatTemplate, { addGenerationPrompt: true });
    assert.ok(prompt.includes('<BOS>'));
    assert.ok(prompt.includes('<I_EXPLAIN>'));
    assert.ok(prompt.includes('<I_QUESTION>'));
    assert.ok(prompt.includes('<TOOL_CALL>'));
    assert.ok(prompt.includes('<TOOL_RESULT>'));
    assert.ok(prompt.includes('<I_ANSWER>'));
  });
});
