'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  BridgeFactory,
  FileSystemBridge,
  MessageQueueBridge,
  PowernautBridge,
} = require('../runtime/src/micronaut_bridges.js');

function startMockGlslServer(port = 19061) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const data = body ? JSON.parse(body) : {};
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/health') {
          res.end(JSON.stringify({ status: 'ok', backend: 'mock_gl43' }));
          return;
        }
        if (req.url === '/dispatch') {
          const out = data.outputs?.output || [1];
          const size = Array.isArray(out) ? out.reduce((a, b) => a * b, 1) : 1;
          res.end(JSON.stringify({
            status: 'ok',
            outputs: { output: Array.from({ length: size }, (_, i) => i + 1) },
          }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });
    srv.listen(port, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${port}` }));
  });
}

describe('Micronaut bridge layer', () => {
  it('lists bridge categories and creates by alias', () => {
    const types = BridgeFactory.listTypes();
    assert.ok(types.runtime.includes('powernaut-glsl'));
    assert.ok(types.system.includes('filesystem'));

    const fsBridge = BridgeFactory.create('fs', { basePath: process.cwd() });
    assert.ok(fsBridge instanceof FileSystemBridge);
  });

  it('supports filesystem bridge read/write/list', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuhul-bridge-'));
    try {
      const bridge = new FileSystemBridge({
        basePath: tmp,
        allowedExtensions: ['.json'],
      });
      await bridge.connect('workspace', { create: true });
      await bridge.send('workspace', {
        operation: 'write',
        data: { path: 'sample.json', content: '{"ok":true}' },
      });
      const read = await bridge.send('workspace', {
        operation: 'read',
        data: { path: 'sample.json' },
      });
      assert.equal(read.content, '{"ok":true}');

      const files = await bridge.send('workspace', { operation: 'list', data: {} });
      assert.ok(files.some((f) => f.name === 'sample.json'));
      await bridge.disconnect('workspace');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('supports in-memory message queue bridge', async () => {
    const bridge = new MessageQueueBridge();
    await bridge.connect('q1');
    await bridge.send('q1', { operation: 'publish', data: { hello: 'world' } });
    const messages = await bridge.send('q1', { operation: 'subscribe' });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].data.hello, 'world');

    await bridge.send('q1', { operation: 'acknowledge', data: { index: 0 } });
    const remaining = await bridge.send('q1', { operation: 'subscribe' });
    assert.equal(remaining.length, 0);
    await bridge.disconnect('q1');
  });

  it('wraps powernaut transport through a bridge contract', async () => {
    const { srv, url } = await startMockGlslServer();
    try {
      const bridge = new PowernautBridge({ endpoint: url, timeoutMs: 2000 });
      await bridge.connect('gpu');

      const health = await bridge.send('gpu', { operation: 'health' });
      assert.equal(health.ok, true);
      assert.equal(health.data.status, 'ok');

      const dispatch = await bridge.send('gpu', {
        operation: 'dispatch',
        payload: {
          program: {
            '@control': [{
              '@kernel': 'matmul',
              '@tensors': {
                input: [1, 2, 3, 4],
                weight: [1, 0, 0, 1],
                bias: [0, 0],
              },
              '@params': { out_rows: 2, out_cols: 2, in_dim: 2 },
            }],
          },
        },
      });
      assert.equal(dispatch.ok, true);
      assert.ok(Array.isArray(dispatch.data.outputs.output));
      await bridge.disconnect('gpu');
    } finally {
      srv.close();
    }
  });
});
