// test/cli_gpu.test.js — verify kuhul-es gpu command
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLI = path.join(__dirname, '..', 'bin', 'kuhul-es.js');

describe('CLI gpu command', () => {
  it('probes kernels and can write them to a directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuhul-gpu-'));
    const r = spawnSync(process.execPath, [CLI, 'gpu', '--kernel-out', tmpDir], {
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(r.status, 0, `CLI failed: ${r.stderr}`);
    assert.match(r.stdout, /Kernel matmul:/);
    assert.match(r.stdout, /Kernel gelu:/);
    assert.match(r.stdout, /Kernel layernorm:/);
    assert.match(r.stdout, /Remote probe:/);

    assert.ok(fs.existsSync(path.join(tmpDir, 'matmul.glsl')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'gelu.glsl')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'layernorm.glsl')));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
