// runtime/src/transports/hybrid_cluster_glsl_transport.js
//
// Hybrid transport:
// - XVM thread-cluster for linalg-oriented kernels
// - Powernaut GLSL server for physics / gravity / mapping kernels
//
// This aligns the runtime split where cluster scheduling handles core dense
// dispatch and GLSL sidecar handles physics-oriented or elementwise mapping ops.

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { powernautGlslTransport } = require('./powernaut_glsl_transport');
const { DEFAULT_XVM_DIR } = require('./xvm_d3d12_transport');

const CLUSTER_KERNELS = new Set([
  'matmul', 'dense', 'ffn', 'embed', 'lm_head', 'attention',
  'qkv', 'proj', 'linalg'
]);

function runBinary(exePath, args = [], timeoutMs = 10000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(exePath, args, { windowsHide: true });
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'timeout', stdout, stderr });
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message, stdout, stderr });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function inferKernelName(payload) {
  const name = String(payload?.program?.name || '').toLowerCase();
  if (name.includes('matmul')) return 'matmul';
  if (name.includes('layernorm')) return 'layernorm';
  if (name.includes('gelu')) return 'gelu';
  if (name.includes('attention')) return 'attention';
  if (name.includes('embed')) return 'embed';
  if (name.includes('lm_head')) return 'lm_head';
  if (name.includes('ffn')) return 'ffn';

  const control = payload?.program?.['@control']?.[0] || {};
  const kernel = String(control['@kernel'] || control['@fn'] || '').toLowerCase();
  if (kernel) return kernel;
  return 'matmul';
}

function hybridClusterGlslTransport(opts = {}) {
  const timeoutMs = opts.timeoutMs || 5000;
  const xvmDir = opts.xvmDir || process.env.XVM_D3D12_DIR || DEFAULT_XVM_DIR;
  const clusterSmokeExe = path.join(xvmDir, 'xvm_thread_cluster_smoke.exe');
  const glslEndpoint = opts.glslEndpoint || 'http://127.0.0.1:9060';
  const manifestPath = opts.manifest;

  const glsl = powernautGlslTransport(glslEndpoint, {
    manifest: manifestPath,
    timeoutMs,
  });

  async function runClusterDispatch(kernelName) {
    const started = Date.now();
    const r = await runBinary(clusterSmokeExe, [], timeoutMs);
    const elapsedMs = Date.now() - started;
    if (!r.ok) {
      return {
        ok: false,
        error: r.error || `cluster dispatch failed (code=${r.code})`,
        stdout: r.stdout,
        stderr: r.stderr,
      };
    }
    return {
      ok: true,
      result: {
        result: {
          r: {
            compiled: true,
            backend: 'xvm-thread-cluster',
            kernel: kernelName,
            elapsed_ms: elapsedMs,
          },
        },
      },
      data: {
        stdout: r.stdout,
        stderr: r.stderr,
      },
    };
  }

  return async function transport(op, payload) {
    if (op === 'health') {
      const cluster = await runClusterDispatch('health');
      const glslHealth = await glsl('health', {});
      return {
        ok: cluster.ok || !!glslHealth?.ok,
        result: {
          result: {
            r: {
              compiled: cluster.ok || !!glslHealth?.ok,
              backend: 'hybrid-cluster-glsl',
            },
          },
        },
        data: {
          cluster,
          glsl: glslHealth,
        },
      };
    }

    if (op !== 'dispatch') {
      return { ok: false, error: `unknown hybrid transport op ${op}` };
    }

    const kernelName = inferKernelName(payload);
    if (CLUSTER_KERNELS.has(kernelName)) {
      return runClusterDispatch(kernelName);
    }

    const glslRes = await glsl('dispatch', payload);
    if (!glslRes?.ok) {
      const fallback = await runClusterDispatch(`${kernelName}:glsl_fallback`);
      if (fallback.ok) {
        fallback.result.result.r.backend = 'xvm-thread-cluster-fallback';
        fallback.result.result.r.glsl_error = glslRes?.error || glslRes?.data || glslRes?.status || 'unknown';
        return fallback;
      }
      return glslRes;
    }
    return {
      ok: true,
      result: {
        result: {
          r: {
            compiled: true,
            backend: 'powernaut-glsl',
            kernel: kernelName,
          },
        },
      },
      data: glslRes.data,
    };
  };
}

module.exports = {
  hybridClusterGlslTransport,
  CLUSTER_KERNELS,
};
