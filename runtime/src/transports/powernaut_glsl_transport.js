// runtime/src/transports/powernaut_glsl_transport.js
//
// Transport adapter that maps KUHUL-ES trainer/runtime dispatch calls to the
// Powernaut GLSL Object Server protocol (glsl_server.py / GLSL_Server.exe).
//
// Powernaut server endpoints:
//   GET  /health
//   GET  /manifest
//   POST /dispatch  { opcode|name, inputs, outputs, params, readback }
//   POST /chain     { ops: [dispatch payloads] }
//   POST /compile   { opcode|name }
//
// The server expects inputs/outputs as numeric arrays or base64 bytes, and
// binds SSBO slots according to the manifest's "bindings" array.

'use strict';

const http = require('http');

function flattenFloat32(arr) {
  if (arr instanceof Float32Array) return arr;
  if (ArrayBuffer.isView(arr)) return new Float32Array(arr.buffer);
  return Float32Array.from(arr);
}

function httpRequest(baseUrl, method, path, body, timeoutMs = 3000) {
  const url = new URL(path, baseUrl);
  const payload = body ? JSON.stringify(body) : '';
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ ok: res.statusCode === 200, status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ ok: false, status: res.statusCode, data });
          }
        });
      },
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// Map KUHUL-ES node roles / kernels to Powernaut op names.
const KERNEL_TO_OP = {
  matmul: 'WO_DENSE',
  dense: 'WO_DENSE',
  ffn: 'WO_DENSE',
  embed: 'WO_DENSE',
  lm_head: 'WO_DENSE',
  gelu: 'WO_GEGLU',     // closest gate shape; elementwise unary dispatch works too
  swiglu: 'WO_SWIGLU',
  layernorm: 'WO_RMS_NORM',
  rms_norm: 'WO_RMS_NORM',
  softmax: 'WO_SOFTMAX',
  attention: 'WO_SOFTMAX', // server maps attention fold to softmax in _fold_dispatch
  adam: 'WO_ADAM_STEP',
};

// Binding roles in Powernaut manifest order for common ops.
const OP_ROLE_LAYOUT = {
  WO_DENSE: ['input', 'weight', 'bias', 'output', 'params'],
  WO_GEGLU: ['input', 'input', 'output', 'params'],     // two inputs, one output
  WO_SWIGLU: ['input', 'input', 'output', 'params'],
  WO_RMS_NORM: ['input', 'output', 'params'],
  WO_SOFTMAX: ['input', 'output', 'params'],
  WO_ADAM_STEP: ['param', 'grad', 'momentum', 'velocity', 'params'],
};

function inferShapeFromRole(role, params) {
  const rows = params.out_rows || params.rows || 1;
  const cols = params.out_cols || params.cols || 1;
  if (role === 'input') return params.input_shape || [rows, params.in_dim || cols];
  if (role === 'weight') return params.weight_shape || [cols, params.in_dim || cols];
  if (role === 'bias') return [cols];
  if (role === 'output') return params.output_shape || [rows, cols];
  if (role === 'param') return params.param_shape || [params.count || 1];
  if (role === 'grad') return params.grad_shape || [params.count || 1];
  if (role === 'momentum') return [params.count || 1];
  if (role === 'velocity') return [params.count || 1];
  return [1];
}

function buildDispatchPayload(opName, params, tensors) {
  const layout = OP_ROLE_LAYOUT[opName] || [];
  const inputs = {};
  const outputs = {};
  let inputSlot = 0;
  for (let i = 0; i < layout.length; i++) {
    const role = layout[i];
    if (role === 'params') continue;

    const isFirstInput = role === 'input' && inputSlot === 0;
    if (role === 'input') inputSlot += 1;
    const tensorKey = role === 'input'
      ? (isFirstInput ? 'input' : 'input_b')
      : role;

    let data = tensors[tensorKey];
    if (data === undefined && role !== 'input') data = tensors[role];
    if (data !== undefined) {
      const arrKey = role === 'input'
        ? (isFirstInput ? 'input' : 'input_b')
        : role;
      inputs[arrKey] = Array.from(flattenFloat32(data));
    }
    outputs[role] = inferShapeFromRole(role, params);
  }
  return {
    opcode: opName,
    inputs,
    outputs,
    params,
    readback: Object.keys(outputs),
  };
}

function powernautGlslTransport(endpoint = 'http://127.0.0.1:9060', opts = {}) {
  const manifestPath = opts.manifest; // optional: path to server.glsl.json for opcode validation
  const timeoutMs = opts.timeoutMs || 3000;

  return async function transport(op, payload) {
    if (op === 'health') {
      return httpRequest(endpoint, 'GET', '/health', null, timeoutMs);
    }

    if (op === 'dispatch') {
      // payload shape from trainer: { program: { '@control': [...] } }
      const controls = payload?.program?.['@control'] || [];
      const steps = [];
      for (const c of controls) {
        const source = c['@source'];
        const profile = c['@profile'];
        const kernelName = c['@kernel'] || c['@fn'] || 'matmul';
        const opName = KERNEL_TO_OP[kernelName] || c['@opcode'] || 'WO_DENSE';
        const params = { ...(c['@params'] || {}), ...(payload.program['@state'] || {}) };
        const tensors = c['@tensors'] || {};

        if (profile === 'glsl' && source) {
          // If raw GLSL source is provided, use /compile to validate shader cache,
          // then /dispatch with the manifest op name.
          const compileRes = await httpRequest(endpoint, 'POST', '/compile', { opcode: opName }, timeoutMs);
          if (!compileRes.ok) return compileRes;
        }

        steps.push(buildDispatchPayload(opName, params, tensors));
      }

      if (steps.length === 0) {
        return { ok: false, error: 'no dispatch steps' };
      }
      if (steps.length === 1) {
        return httpRequest(endpoint, 'POST', '/dispatch', steps[0], timeoutMs);
      }
      return httpRequest(endpoint, 'POST', '/chain', { ops: steps }, timeoutMs);
    }

    return { ok: false, error: `unknown transport op ${op}` };
  };
}

module.exports = {
  powernautGlslTransport,
  KERNEL_TO_OP,
  OP_ROLE_LAYOUT,
  buildDispatchPayload,
};
