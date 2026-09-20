#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
  return [
    'webgl2_full_model_sweep.cjs',
    '',
    'Usage:',
    '  node dist\\kuhul-es\\runtime\\src\\webgl2_full_model_sweep.cjs \\',
    '    --input model.safetensors --output model.webgl2.full-sweep.safetensors \\',
    '    [--token-bin tokens.bin] [--train-dim 1024] [--steps-per-tensor 64] \\',
    '    [--batch 16] [--lr 0.00025] [--browser auto] [--all-tensors]',
    '',
    'Notes:',
    '  - Sequentially runs the bounded WebGL2 trainer over eligible F32 tensors.',
    '  - This is full-model GPU coverage by streaming tensors, not full model residency in VRAM.',
    '  - Defaults to .weight tensors and the first 24 tensors unless --all-tensors is set.',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {};
  const multivalue = new Set(['token-bin']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      if (multivalue.has(key)) {
        if (!Array.isArray(out[key])) out[key] = [];
        out[key].push(next);
      } else {
        out[key] = next;
      }
      i++;
    }
  }
  if (out.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!out.input || !out.output) {
    throw new Error('Missing --input or --output.\n\n' + usage());
  }
  const trainDim = parseInt(out['train-dim'] || '1024', 10);
  const stepsPerTensor = parseInt(out['steps-per-tensor'] || out.steps || '64', 10);
  const batch = parseInt(out.batch || '16', 10);
  const lr = Number(out.lr || '0.00025');
  const timeoutMs = parseInt(out['timeout-ms'] || '600000', 10);
  const progressInterval = parseInt(out['progress-interval'] || '16', 10);
  const maxTensors = parseInt(out['max-tensors'] || '24', 10);
  const tensorFilter = String(out['tensor-filter'] || '\\.weight$');
  return {
    input: path.resolve(out.input),
    output: path.resolve(out.output),
    tokenBins: normalizeList(out['token-bin']),
    trainDim,
    stepsPerTensor,
    batch,
    lr,
    seed: parseInt(out.seed || '1337', 10),
    browser: String(out.browser || 'auto').toLowerCase(),
    timeoutMs,
    progressInterval,
    maxTensors,
    tensorFilter,
    includeBias: !!out['include-bias'],
    allTensors: !!out['all-tensors'],
    progress: !!out.progress,
    keepTemps: !!out['keep-temps'],
    trainerScript: out['trainer-script'] ? path.resolve(out['trainer-script']) : resolveTrainerScript(),
  };
}

function normalizeList(raw) {
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const out = [];
  for (const value of values) {
    for (const part of String(value).split(/[;,]/g)) {
      const p = part.trim();
      if (p) out.push(path.resolve(p));
    }
  }
  return Array.from(new Set(out));
}

function resolveTrainerScript() {
  const candidates = [
    path.resolve(__dirname, 'webgl2_hf_safetensor_trainer.cjs'),
    path.resolve(__dirname, '..', '..', '..', 'kuhul-runtime-v1', 'trainer', 'webgl2_hf_safetensor_trainer.cjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function readU64LE(buffer, offset) {
  return buffer.readUInt32LE(offset) + buffer.readUInt32LE(offset + 4) * 4294967296;
}

function readSafetensorsHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const lenBuf = Buffer.alloc(8);
    if (fs.readSync(fd, lenBuf, 0, 8, 0) !== 8) throw new Error('Invalid safetensors file.');
    const headerBytes = readU64LE(lenBuf, 0);
    const headerBuf = Buffer.alloc(headerBytes);
    if (fs.readSync(fd, headerBuf, 0, headerBytes, 8) !== headerBytes) {
      throw new Error('Failed to read safetensors header.');
    }
    return JSON.parse(headerBuf.toString('utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

function tensorElements(shape) {
  if (!Array.isArray(shape) || !shape.length) return 0;
  return shape.reduce((acc, dim) => acc * (Number.isInteger(dim) && dim > 0 ? dim : 0), 1);
}

function selectTensors(header, options) {
  const re = new RegExp(options.tensorFilter);
  const tensors = [];
  for (const [name, entry] of Object.entries(header)) {
    if (name === '__metadata__' || !entry || typeof entry !== 'object') continue;
    if (entry.dtype !== 'F32') continue;
    if (!Array.isArray(entry.shape) || !Array.isArray(entry.data_offsets)) continue;
    if (!options.includeBias && /\.bias$/.test(name)) continue;
    if (!re.test(name)) continue;
    const elements = tensorElements(entry.shape);
    if (elements <= 0) continue;
    tensors.push({ name, shape: entry.shape, elements });
  }
  tensors.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (options.allTensors) return tensors;
  return tensors.slice(0, Math.max(1, options.maxTensors));
}

function emit(options, event, payload = {}) {
  const message = {
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  if (options.progress) {
    process.stdout.write(JSON.stringify(message) + '\n');
  } else {
    const suffix = payload.message ? ` ${payload.message}` : '';
    console.log(`[webgl2-sweep] ${event}${suffix}`);
  }
}

function runTensorPass(options, tensor, inputPath, outputPath, index, total) {
  const args = [
    options.trainerScript,
    '--input', inputPath,
    '--output', outputPath,
    '--tensor', tensor.name,
    '--train-dim', String(options.trainDim),
    '--batch', String(options.batch),
    '--steps', String(options.stepsPerTensor),
    '--lr', String(options.lr),
    '--seed', String(options.seed + index),
    '--browser', options.browser,
    '--timeout-ms', String(options.timeoutMs),
    '--progress',
    '--progress-interval', String(options.progressInterval),
  ];
  for (const tokenBin of options.tokenBins) {
    args.push('--token-bin', tokenBin);
  }
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
  if (result.stdout) {
    for (const line of result.stdout.split(/\r?\n/g)) {
      if (!line.trim()) continue;
      try {
        const childEvent = JSON.parse(line);
        emit(options, 'tensor_child_event', {
          tensor: tensor.name,
          tensor_index: index,
          tensor_count: total,
          child: childEvent,
        });
      } catch {
        emit(options, 'tensor_stdout', {
          tensor: tensor.name,
          tensor_index: index,
          tensor_count: total,
          message: line,
        });
      }
    }
  }
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Tensor pass failed for ${tensor.name} with exit code ${result.status}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.input)) throw new Error(`Input not found: ${options.input}`);
  if (!fs.existsSync(options.trainerScript)) throw new Error(`Trainer script not found: ${options.trainerScript}`);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });

  const header = readSafetensorsHeader(options.input);
  const tensors = selectTensors(header, options);
  if (!tensors.length) throw new Error(`No F32 tensors matched filter: ${options.tensorFilter}`);

  emit(options, 'sweep_start', {
    input: options.input,
    output: options.output,
    tensor_count: tensors.length,
    all_tensors: options.allTensors,
    tensor_filter: options.tensorFilter,
    train_dim: options.trainDim,
    steps_per_tensor: options.stepsPerTensor,
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webgl2-full-sweep-'));
  let currentInput = options.input;
  let previousTemp = '';
  const started = Date.now();

  try {
    for (let i = 0; i < tensors.length; i++) {
      const tensor = tensors[i];
      const isLast = i === tensors.length - 1;
      const nextOutput = isLast ? options.output : path.join(tempDir, `pass_${String(i).padStart(4, '0')}.safetensors`);
      emit(options, 'tensor_start', {
        tensor: tensor.name,
        tensor_index: i + 1,
        tensor_count: tensors.length,
        shape: tensor.shape,
        elements: tensor.elements,
        output: nextOutput,
      });
      runTensorPass(options, tensor, currentInput, nextOutput, i + 1, tensors.length);
      emit(options, 'tensor_done', {
        tensor: tensor.name,
        tensor_index: i + 1,
        tensor_count: tensors.length,
      });
      if (previousTemp && !options.keepTemps) {
        try { fs.unlinkSync(previousTemp); } catch {}
      }
      previousTemp = nextOutput === options.output ? '' : nextOutput;
      currentInput = nextOutput;
    }
  } finally {
    if (!options.keepTemps) {
      if (previousTemp) {
        try { fs.unlinkSync(previousTemp); } catch {}
      }
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }

  const summary = {
    '@kind': 'xjsl.webgl2.full_model_sweep.v1',
    input: options.input,
    output: options.output,
    tensor_count: tensors.length,
    tensors: tensors.map((t) => ({ name: t.name, shape: t.shape, elements: t.elements })),
    train_dim: options.trainDim,
    steps_per_tensor: options.stepsPerTensor,
    batch: options.batch,
    lr: options.lr,
    wall_ms: Date.now() - started,
    mode: 'streamed_tensor_slice_gpu_sweep',
  };
  fs.writeFileSync(options.output + '.sweep.xjsl.json', JSON.stringify(summary, null, 2));
  emit(options, 'sweep_result', summary);
}

main();

