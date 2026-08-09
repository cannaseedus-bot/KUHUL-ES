#!/usr/bin/env node
// scripts/copy-pcre2.js
// Copy PCRE2 WASM distribution files from @ofjansen/pcre2-wasm into ./pcre2/

const fs = require('fs');
const path = require('path');

async function main() {
  const outDir = path.resolve(process.cwd(), 'pcre2');
  const args = process.argv.slice(2);
  let srcDir = args[0];

  const candidates = [];
  if (!srcDir) {
    // common locations
    candidates.push(path.resolve(process.cwd(), 'node_modules', '@ofjansen', 'pcre2-wasm', 'dist'));
    candidates.push(path.resolve(__dirname, '..', 'node_modules', '@ofjansen', 'pcre2-wasm', 'dist'));
  } else {
    candidates.push(path.resolve(process.cwd(), srcDir));
  }

  let found = null;
  for (const c of candidates) {
    if (!c) continue;
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) { found = c; break; }
  }

  if (!found) {
    console.error('Could not find @ofjansen/pcre2-wasm dist directory.');
    console.error('Please install the package locally:');
    console.error('  npm install @ofjansen/pcre2-wasm --save');
    console.error('Or pass the dist path as an argument: node scripts/copy-pcre2.js /path/to/pcre2/dist');
    process.exit(2);
  }

  console.log('Copying PCRE2 files from:', found);
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs.readdirSync(found).filter(f => !f.startsWith('.'));
  let copied = 0;
  for (const f of files) {
    const src = path.join(found, f);
    const dst = path.join(outDir, f);
    try {
      fs.copyFileSync(src, dst);
      console.log('  ->', f);
      copied++;
    } catch (e) {
      console.warn('  copy failed:', f, e.message || e);
    }
  }

  if (copied === 0) {
    console.error('No files were copied. Check the source directory contents.');
    process.exit(3);
  }

  console.log(`PCRE2 distribution copied to ${outDir} (${copied} files).`);
  process.exit(0);
}

main();
