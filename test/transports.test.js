// test/transports.test.js — backend transport shape tests
//
// These tests use a local in-process mock GLSL server so the kuhul-es test
// suite stays self-contained and does not depend on external GPU drivers or
// the Powernaut GLSL_Server.exe binary.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const {
  powernautGlslTransport,
  KERNEL_TO_OP,
  OP_ROLE_LAYOUT,
  buildDispatchPayload,
} = require('../runtime/src/transports/powernaut_glsl_transport.js');
const { xvmD3d12Transport, DEFAULT_XVM_DIR } = require('../runtime/src/transports/xvm_d3d12_transport.js');

function startMockGlslServer(port = 19060) {
  return new Promise((resolve) => {
    const state = { requests: [] };
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          state.requests.push({ method: req.method, path: req.url, data });
          res.setHeader('Content-Type', 'application/json');
          if (req.url === '/health') {
            res.end(JSON.stringify({ status: 'ok', backend: 'mock_gl43' }));
          } else if (req.url === '/dispatch') {
            // Echo a deterministic result based on the request shape.
            const outLen = data.outputs?.output
              ? (Array.isArray(data.outputs.output) ? data.outputs.output.reduce((a, b) => a * b, 1) : 1)
              : 1;
            res.end(JSON.stringify({
              status: 'ok',
              outputs: {
                output: Array.from({ length: outLen }, (_, i) => 1.0 + i * 0.1),
              },
              op: data.opcode || 'UNKNOWN',
            }));
          } else if (req.url === '/chain') {
            res.end(JSON.stringify({ status: 'ok', results: data.ops?.map(() => ({ status: 'ok' })) || [] }));
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'not found' }));
          }
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    });
    srv.listen(port, '127.0.0.1', () => resolve({ srv, state, url: `http://127.0.0.1:${port}` }));
  });
}

describe('Powernaut GLSL transport', () => {
  it('maps kuhul kernel names to Powernaut opcodes', () => {
    assert.equal(KERNEL_TO_OP.matmul, 'WO_DENSE');
    assert.equal(KERNEL_TO_OP.layernorm, 'WO_RMS_NORM');
    assert.equal(KERNEL_TO_OP.gelu, 'WO_GEGLU');
    assert.equal(KERNEL_TO_OP.softmax, 'WO_SOFTMAX');
    assert.equal(KERNEL_TO_OP.adam, 'WO_ADAM_STEP');
  });

  it('builds a WO_DENSE dispatch payload', () => {
    const p = buildDispatchPayload('WO_DENSE', { rows: 2, cols: 3, in_dim: 4, out_cols: 3 }, {
      input: [1, 2, 3, 4, 5, 6, 7, 8],
      weight: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2],
      bias: [0, 0, 0],
    });
    assert.equal(p.opcode, 'WO_DENSE');
    assert.ok(Array.isArray(p.inputs.input));
    assert.ok(Array.isArray(p.inputs.weight));
    assert.ok(Array.isArray(p.inputs.bias));
    assert.deepEqual(p.outputs.output, [2, 3]);
    assert.deepEqual(p.readback, ['input', 'weight', 'bias', 'output']);
  });

  it('builds a WO_GEGLU dispatch payload with two inputs', () => {
    const p = buildDispatchPayload('WO_GEGLU', { rows: 4 }, {
      input: [1, 2, 3, 4],
      input_b: [0.1, 0.2, 0.3, 0.4],
    });
    assert.equal(p.opcode, 'WO_GEGLU');
    assert.deepEqual(p.inputs.input, [1, 2, 3, 4]);
    assert.equal(p.inputs.input_b.length, 4);
    assert.ok(Math.abs(p.inputs.input_b[0] - 0.1) < 1e-6);
    assert.deepEqual(p.readback, ['input', 'output']);
  });

  it('returns a transport function', () => {
    const t = powernautGlslTransport('http://127.0.0.1:9060');
    assert.equal(typeof t, 'function');
  });

  it('health and dispatch against a mock server', async () => {
    const { srv, state, url } = await startMockGlslServer();
    try {
      const t = powernautGlslTransport(url, { timeoutMs: 2000 });
      const health = await t('health');
      assert.equal(health.ok, true);
      assert.equal(health.data.status, 'ok');

      const r = await t('dispatch', {
        program: {
          '@control': [{
            '@fn': 'dispatch',
            '@kernel': 'matmul',
            '@tensors': {
              input: [1, 2, 3, 4, 5, 6, 7, 8],
              weight: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2],
              bias: [0, 0, 0],
            },
            '@params': { in_dim: 4, out_rows: 2, out_cols: 3 },
          }],
        },
      });
      assert.ok(r.ok, `dispatch failed: ${r.error || JSON.stringify(r.data)}`);
      assert.ok(state.requests.some((req) => req.path === '/dispatch'));
      assert.equal(state.requests.find((req) => req.path === '/dispatch').data.opcode, 'WO_DENSE');
      assert.ok(Array.isArray(r.data.outputs.output));
    } finally {
      srv.close();
    }
  });
});

describe('XVM D3D12 transport', () => {
  it('has the default XVM directory', () => {
    assert.ok(DEFAULT_XVM_DIR.includes('xvm-d3d12'));
  });

  it('returns a transport function', () => {
    const t = xvmD3d12Transport({ xvmDir: DEFAULT_XVM_DIR });
    assert.equal(typeof t, 'function');
  });

  it('health op shells out to scx2_runtime_smoke', async () => {
    const t = xvmD3d12Transport({ xvmDir: DEFAULT_XVM_DIR });
    const r = await t('health');
    // Binary may or may not exist; either way we get a shaped response.
    assert.ok(typeof r === 'object');
    assert.ok('ok' in r);
  });

  it('dispatch requires @tape path', async () => {
    const t = xvmD3d12Transport({ xvmDir: DEFAULT_XVM_DIR });
    const r = await t('dispatch', { program: {} });
    assert.equal(r.ok, false);
    assert.match(r.error, /requires a compiled SCX2 tape/);
  });
});
