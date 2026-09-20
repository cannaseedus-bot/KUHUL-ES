#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveImplementation() {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'kuhul-runtime-v1', 'trainer', 'webgl2_hf_safetensor_trainer.cjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'WebGL2 trainer implementation not found. Tried:\n' +
    candidates.map((p) => `  ${p}`).join('\n')
  );
}

function main() {
  const impl = resolveImplementation();
  const args = [impl, ...process.argv.slice(2)];
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error('[webgl2_hf_safetensor_trainer_wrapper] ' + result.error.message);
    process.exit(1);
  }
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

main();

