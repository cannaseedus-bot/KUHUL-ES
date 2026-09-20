'use strict';
// Compile runtime/src/fold-engine.ts to CommonJS + ESM outputs.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'runtime', 'src', 'fold-engine.ts');
const cjsOutDir = path.join(root, 'runtime', 'src');
const esmOutDir = path.join(root, 'runtime', 'src', 'esm');

function run(cmd) {
  console.log('> ' + cmd);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

// CommonJS + declaration
run(`npx tsc "${src}" --outDir "${cjsOutDir}" --module commonjs --target ES2022 --esModuleInterop --skipLibCheck --declaration`);

// ESM
fs.rmSync(esmOutDir, { recursive: true, force: true });
run(`npx tsc "${src}" --outDir "${esmOutDir}" --module ES2022 --target ES2022 --esModuleInterop --skipLibCheck`);

const esmJs = path.join(esmOutDir, 'fold-engine.js');
const esmMjs = path.join(cjsOutDir, 'fold-engine.mjs');
fs.renameSync(esmJs, esmMjs);
fs.rmSync(esmOutDir, { recursive: true, force: true });

console.log('fold-engine compiled: fold-engine.js + fold-engine.mjs + fold-engine.d.ts');
