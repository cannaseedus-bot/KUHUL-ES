#!/usr/bin/env node
'use strict';

/*
 * BASHER — KUHUL Operator Shell
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { program } = require('commander');

const pkg = require('../package.json');

// -----------------------------------------------------------------------------
// Banner
// -----------------------------------------------------------------------------
console.log(`
╔══════════════════════════════════════╗
║           BASHER v${pkg.version}                ║
║     KUHUL Operator Control Shell     ║
╚══════════════════════════════════════╝
`);

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
program
  .name('basher')
  .description('KUHUL Operator Shell')
  .version(pkg.version);

// -----------------------------------------------------------------------------
// exec
// -----------------------------------------------------------------------------
program
  .command('exec <cmd>')
  .description('Execute an operator command')
  .option('--record', 'Record execution trace')
  .action((cmd, options) => {
    console.log(`▶ Executing: ${cmd}`);

    if (options.record) {
      const trace = {
        type: 'basher.exec',
        cmd,
        cwd: process.cwd(),
        timestamp: new Date().toISOString()
      };

      trace.hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(trace))
        .digest('hex');

      fs.writeFileSync(
        path.resolve(process.cwd(), 'basher-trace.json'),
        JSON.stringify(trace, null, 2)
      );

      console.log('Trace recorded');
      console.log(`Hash: ${trace.hash}`);
    }

    console.log('✓ Execution complete (stub)');
    process.exit(0);
  });

// -----------------------------------------------------------------------------
// trainer.webgl2
// -----------------------------------------------------------------------------
program
  .command('trainer.webgl2')
  .description('Launch kuhul-es WebGL2 safetensor trainer lane')
  .requiredOption('--input <path>', 'Input safetensors model')
  .requiredOption('--output <path>', 'Output safetensors model')
  .option('--token-bin <path...>', 'Packed token bin path(s); supports repeated flag or ; separated list')
  .option('--tensor <name>', 'Tensor name to train (F32)')
  .option('--train-dim <n>', 'Bounded train dimension', '512')
  .option('--batch <n>', 'Batch size', '16')
  .option('--steps <n>', 'Training steps', '24')
  .option('--lr <v>', 'Learning rate', '0.0006')
  .option('--seed <n>', 'Deterministic seed', '1337')
  .option('--browser <name>', 'Browser runtime: auto, edge, or chrome', 'auto')
  .option('--timeout-ms <n>', 'Max runtime timeout in milliseconds', '180000')
  .option('--xjsl-out <path>', 'XJSL sidecar output path')
  .option('--progress-interval <n>', 'Emit progress every n steps', '4')
  .option('--trainer-script <path>', 'Override trainer script path')
  .option('--cwd <path>', 'Working directory for trainer process')
  .option('--dry-run', 'Print resolved command and exit')
  .option('--progress', 'Enable NDJSON progress events (default)')
  .option('--no-progress', 'Disable NDJSON progress events')
  .option('--json', 'Print raw NDJSON progress events')
  .action((options) => {
    const cliPath = path.resolve(__dirname, 'kuhul-es.js');
    const args = [
      cliPath,
      'train-webgl2',
      '--input', options.input,
      '--output', options.output,
      '--train-dim', String(options.trainDim),
      '--batch', String(options.batch),
      '--steps', String(options.steps),
      '--lr', String(options.lr),
      '--seed', String(options.seed),
      '--browser', String(options.browser || 'auto'),
      '--timeout-ms', String(options.timeoutMs),
      '--progress-interval', String(options.progressInterval || '4'),
    ];

    const tokenBins = Array.isArray(options.tokenBin) ? options.tokenBin : [];
    for (const tokenBin of tokenBins) {
      args.push('--token-bin', String(tokenBin));
    }
    if (options.tensor) args.push('--tensor', String(options.tensor));
    if (options.xjslOut) args.push('--xjsl-out', String(options.xjslOut));
    if (options.trainerScript) args.push('--trainer-script', String(options.trainerScript));
    if (options.cwd) args.push('--cwd', String(options.cwd));
    if (options.dryRun) args.push('--dry-run');
    if (options.progress === false) args.push('--no-progress');
    if (options.json) args.push('--json');

    console.log('▶ BASHER forwarding to KUHUL-ES WebGL2 trainer');
    const res = spawnSync(process.execPath, args, {
      stdio: 'inherit',
      shell: false,
    });

    if (res.error) {
      console.error('trainer.webgl2 launch error:', res.error.message);
      process.exit(1);
    }
    process.exit(typeof res.status === 'number' ? res.status : 1);
  });

// -----------------------------------------------------------------------------
// doctor
// -----------------------------------------------------------------------------
program
  .command('doctor')
  .description('Basher diagnostics')
  .action(() => {
    console.log('BASHER Doctor\n');
    console.log('Node:', process.version);
    console.log('Platform:', process.platform);
    console.log('CWD:', process.cwd());
    console.log('Commander: OK');
    process.exit(0);
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
