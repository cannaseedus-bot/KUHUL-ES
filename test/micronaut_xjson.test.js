'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MicronautFactory,
  MicronautRegistry,
  FoldRegistry,
  FieldRegistry,
  ToolRegistry,
} = require('../runtime/src/micronaut.js');

function buildFixture() {
  return {
    '@meta': {
      id: 'XM-TEST',
      name: 'XjsonMicronaut',
      version: '1.0.0',
      description: 'XJSON integration test micronaut',
    },
    '@lanes': {
      agent: { '@dict': 0, '@role': 'agent lane' },
      skills: { '@dict': 1, '@role': 'skill lane' },
      experts: { '@dict': 2, '@role': 'expert lane' },
    },
    '@phases': {
      Pop: { '@op': 'load' },
      Wo: { '@op': 'resolve' },
      Sek: { '@op': 'execute' },
      "Ch'en": { '@op': 'update' },
    },
    '@variables': {
      learned: { '@mutability': 'MUTABLE' },
    },
    '@edges': [
      { from: 'skills.generate', to: 'experts.reasoning', weight: 1.0 },
      { from: 'experts', to: 'learned', weight: 1.0 },
    ],
    '@agent.main': {
      id: 'agent-main',
      name: 'XjsonAgent',
      persona: 'Deterministic orchestrator',
      memory: {},
    },
    '@model.core': {
      '@xcfe': 'IMMUTABLE',
      id: 'XM-TEST-core',
      backend: 'local_gguf',
      model: 'xm-test.gguf',
    },
    '@runtime.gpu': {
      enabled: false,
      backend: 'cpu',
    },
    '@moe.router': {
      top_k_experts: 1,
      allow_self_modify: true,
    },
    '@skills': {
      generate: {
        id: 'skill-generate',
        '@phase': 'Sek',
        trigger: 'prompt',
        routes_to: ['experts.reasoning'],
      },
    },
    '@experts': {
      reasoning: {
        id: 'expert-reasoning',
        domain: 'reasoning',
        dispatch_signal: 'route_reasoning',
        routing_bias: 0.0,
      },
    },
  };
}

beforeEach(() => {
  MicronautRegistry.clear();
  FoldRegistry.clear();
  FieldRegistry.clear();
  ToolRegistry.clear();
});

describe('MicronautFactory XJSON integration', () => {
  it('hydrates and registers a micronaut graph from XJSON', async () => {
    const fixture = buildFixture();
    const built = MicronautFactory.fromXjson(fixture);

    assert.equal(built.micronaut.id, 'XM-TEST');
    assert.equal(built.tools.length, 1);
    assert.equal(built.folds.length, 1);
    assert.equal(built.fields.length, 1);
    assert.equal(built.micronaut.orchestrates.length, 1);
    assert.ok(MicronautRegistry.has('XM-TEST'));
    assert.ok(ToolRegistry.has('expert-reasoning'));

    await built.micronaut.start();
    const output = await built.micronaut.orchestrate({ prompt: 'hello' }, { input: { prompt: 'hello' } });
    assert.ok(output.output);
    await built.micronaut.stop();
  });

  it('rejects invalid XJSON section shape', () => {
    assert.throws(
      () => MicronautFactory.fromXjson({ '@meta': { id: 'broken', name: 'broken' } }),
      /missing required sections/
    );
  });

  it('loads from file and preserves optional STB metadata', () => {
    const fixture = buildFixture();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'micronaut-xjson-'));
    const xjsonPath = path.join(tempRoot, 'micronaut.xjson');
    fs.writeFileSync(xjsonPath, JSON.stringify(fixture, null, 2), 'utf8');

    try {
      const built = MicronautFactory.fromXjsonFile(xjsonPath, {
        register: false,
        stbPath: 'E:\\models\\GPT-DDS\\GPT-OSS\\weights.stb',
        datasetPath: 'E:\\data\\ultrachat_jsonl\\ultrachat_basic_chat.jsonl',
      });
      assert.equal(built.micronaut.metadata.model_weights_stb, 'E:\\models\\GPT-DDS\\GPT-OSS\\weights.stb');
      assert.equal(
        built.micronaut.metadata.training_dataset_jsonl,
        'E:\\data\\ultrachat_jsonl\\ultrachat_basic_chat.jsonl'
      );
      assert.equal(built.micronaut.metadata.source_file, path.resolve(xjsonPath));
      assert.throws(
        () => MicronautFactory.fromXjsonFile(path.join(tempRoot, 'micronaut.stb')),
        /Micronaut definitions are XJSON/
      );
      assert.throws(
        () => MicronautFactory.fromXjson(fixture, { datasetPath: 'E:\\data\\ultrachat_jsonl\\ultrachat_basic_chat.txt' }),
        /datasetPath must point to a \.jsonl file/
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
