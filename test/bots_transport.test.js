'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');
const os     = require('node:os');

const { botsTransport, DEFAULT_PHASE_MAP } = require('../runtime/src/transports/bots_transport.js');

// ── mock bots.py — echoes task name and payload back without loading any model
const MOCK_BOTS = `
import sys, json
for raw in sys.stdin:
    raw = raw.strip()
    if not raw: continue
    try:
        msg  = json.loads(raw)
        task = msg.get('task', 'health')
        pl   = msg.get('payload', {})
        if task == 'health':
            result = {'status': 'ok', 'id': 'FACTORY-1-mock'}
        elif task == 'mini_chat':
            result = {'answer': 'mock chat: ' + pl.get('prompt', '')[:30]}
        elif task == 'mini_tool_read':
            result = {'answer': 'mock read: ' + pl.get('question', '')[:30]}
        elif task == 'gemma_complete':
            result = {'answer': 'mock gemma: ' + pl.get('prompt', '')[:30]}
        elif task == 'mini_meta':
            result = {'tools': [{'name': 'lookup_memory'}], 'chat_weights': 'q8.gguf', 'tool_weights': 'q2k.gguf'}
        else:
            result = {'echo': task, 'payload': pl}
        print(json.dumps(result), flush=True)
    except Exception as e:
        print(json.dumps({'error': str(e)}), flush=True)
`;

let mockBotsPath;

before(() => {
  mockBotsPath = path.join(os.tmpdir(), `mock_bots_${process.pid}.py`);
  fs.writeFileSync(mockBotsPath, MOCK_BOTS, 'utf8');
});

after(() => {
  try { fs.unlinkSync(mockBotsPath); } catch {}
});

function makeTransport(phaseMap) {
  return botsTransport({
    python:   'python',
    botsPath: mockBotsPath,
    phaseMap: phaseMap || {},
    timeoutMs: 10000,
  });
}

describe('botsTransport', () => {

  test('DEFAULT_PHASE_MAP covers all six phases', () => {
    for (const phase of ['Pop', 'Wo', 'Yax', 'Sek', 'Chen', 'Xul']) {
      assert.ok(DEFAULT_PHASE_MAP[phase], `missing phase: ${phase}`);
    }
    assert.equal(DEFAULT_PHASE_MAP.Pop,  'gemma');
    assert.equal(DEFAULT_PHASE_MAP.Wo,   'mini_tool_read');
    assert.equal(DEFAULT_PHASE_MAP.Sek,  'mini_chat');
    assert.equal(DEFAULT_PHASE_MAP.Xul,  'mini_chat');
  });

  test('health op returns ok from mock subprocess', async () => {
    const t = makeTransport();
    const r = await t('health', {});
    assert.equal(r.ok, true);
    assert.equal(r.data.status, 'ok');
    await t('shutdown', {});
  });

  test('Sek phase dispatches to mini_chat', async () => {
    const t = makeTransport();
    const r = await t('dispatch', { phase: 'Sek', prompt: 'What is GPT-2?' });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'mini_chat');
    assert.ok(r.data.answer.startsWith('mock chat:'));
    await t('shutdown', {});
  });

  test('Pop phase dispatches to gemma', async () => {
    const t = makeTransport();
    const r = await t('dispatch', { phase: 'Pop', question: 'What is the entropy constant?' });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'gemma');
    assert.ok(r.data.answer.startsWith('mock gemma:'));
    await t('shutdown', {});
  });

  test('Wo phase dispatches to mini_tool_read', async () => {
    const t = makeTransport();
    const r = await t('dispatch', {
      phase:         'Wo',
      question:      'What port does kuhul run on?',
      tools_json:    '[{"name":"lookup_memory"}]',
      tool_call:     '<tool_call>{"name":"lookup_memory","arguments":{"key":"kuhul_engine_port"}}</tool_call>',
      tool_response: '<tool_response>{"result":"17474"}</tool_response>',
    });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'mini_tool_read');
    assert.ok(r.data.answer.startsWith('mock read:'));
    await t('shutdown', {});
  });

  test('all three models dispatched in one fold sequence', async () => {
    const t = makeTransport();
    const phases = [
      { phase: 'Pop',  question: 'Load context for kuhul port' },
      { phase: 'Wo',   question: 'Format port answer', tools_json: '[]', tool_call: '', tool_response: '' },
      { phase: 'Sek',  prompt: 'The kuhul engine runs on' },
      { phase: 'Xul',  prompt: 'Collapse: kuhul port is' },
      { phase: 'Chen', question: 'Record port=17474 in memory' },
      { phase: 'Yax',  question: 'Validate: is 17474 correct?' },
    ];
    const expectedModels = ['gemma', 'mini_tool_read', 'mini_chat', 'mini_chat', 'gemma', 'gemma'];

    for (let i = 0; i < phases.length; i++) {
      const r = await t('dispatch', phases[i]);
      assert.equal(r.ok, true, `phase ${phases[i].phase} failed`);
      assert.equal(r.model, expectedModels[i], `phase ${phases[i].phase} routed to wrong model`);
    }
    await t('shutdown', {});
  });

  test('meta op returns tool list and weight paths', async () => {
    const t = makeTransport();
    const r = await t('meta', { adapter_path: 'dist/jrom-micronaut/mini_micronaut.json' });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.data.tools));
    assert.ok(r.data.chat_weights);
    assert.ok(r.data.tool_weights);
    await t('shutdown', {});
  });

  test('explicit task override bypasses phase map', async () => {
    const t = makeTransport();
    // Pop normally → gemma, but override to mini_chat
    const r = await t('dispatch', { phase: 'Pop', task: 'mini_chat', prompt: 'override test' });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'mini_chat');
    await t('shutdown', {});
  });

  test('unknown op returns error without crashing', async () => {
    const t = makeTransport();
    const r = await t('bogus_op', {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('bogus_op'));
    await t('shutdown', {});
  });

  test('concurrent dispatches serialize correctly', async () => {
    const t = makeTransport();
    const results = await Promise.all([
      t('dispatch', { phase: 'Sek', prompt: 'A' }),
      t('dispatch', { phase: 'Sek', prompt: 'B' }),
      t('dispatch', { phase: 'Pop', question: 'C' }),
    ]);
    assert.ok(results.every(r => r.ok), 'all concurrent dispatches succeeded');
    assert.equal(results[0].model, 'mini_chat');
    assert.equal(results[2].model, 'gemma');
    await t('shutdown', {});
  });

});
