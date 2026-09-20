// runtime/src/transports/xvm_d3d12_transport.js
//
// Stub transport for the XVM D3D12 native execution stack.
//
// XVM binaries live under dist/xvm-d3d12:
//   - xvm_d12.exe / xvm_d12.dll  — runtime driver
//   - xvm_d12_host.exe            — CLI host
//   - gpt2_infer.exe              — D3D12 inference
//   - gpt2_trainer.exe            — D3D11 compute trainer
//   - scx2_runtime_smoke.exe      — adapter probe
//
// The XVM stack uses SCXQ2/SCXG binary tapes and DirectX shaders. It is not
// HTTP-based in the current tree, so this transport shells out to the host
// executables and parses their console output. Future versions can replace
// the shell-out with a named-pipe or COM-RPC sidecar.

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const DEFAULT_XVM_DIR = process.env.XVM_D3D12_DIR || path.join(__dirname, '..', '..', '..', 'bin', 'xvm-d3d12');

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

function xvmD3d12Transport(opts = {}) {
  const xvmDir = opts.xvmDir || process.env.XVM_D3D12_DIR || DEFAULT_XVM_DIR;
  const host = path.join(xvmDir, 'xvm_d12_host.exe');
  const smoke = path.join(xvmDir, 'scx2_runtime_smoke.exe');
  const infer = path.join(xvmDir, 'gpt2_infer.exe');
  const trainer = path.join(xvmDir, 'gpt2_trainer.exe');

  return async function transport(op, payload) {
    if (op === 'health') {
      // Probe adapter detection via scx2_runtime_smoke.
      const r = await runBinary(smoke, ['--probe'], 5000);
      return {
        ok: r.ok,
        data: { stdout: r.stdout, stderr: r.stderr, code: r.code },
        error: r.error,
      };
    }

    if (op === 'dispatch') {
      // XVM dispatch is not yet HTTP. We shell out to the host with a
      // temporary SCX2 tape if a tape path is provided, otherwise report
      // that native dispatch needs a compiled tape.
      const tape = payload?.program?.['@tape'];
      if (!tape) {
        return {
          ok: false,
          error: 'XVM dispatch requires a compiled SCX2 tape path in program.@tape',
          hint: 'Use the XVM compiler (kxc.exe) to produce a .scx2 tape first.',
        };
      }
      return runBinary(host, [tape], 30000);
    }

    if (op === 'infer') {
      const weights = payload?.weights;
      const token = payload?.tokenId ?? 0;
      if (!weights) return { ok: false, error: 'XVM inference requires payload.weights (safetensors path)' };
      return runBinary(infer, [weights, String(token)], 30000);
    }

    if (op === 'train') {
      const data = payload?.data;
      const out = payload?.outDir;
      if (!data) return { ok: false, error: 'XVM train requires payload.data (pre-tokenized binary path)' };
      const args = [data];
      if (out) args.push('--out', out);
      return runBinary(trainer, args, 60000);
    }

    return { ok: false, error: `unknown XVM transport op ${op}` };
  };
}

module.exports = { xvmD3d12Transport, DEFAULT_XVM_DIR };
