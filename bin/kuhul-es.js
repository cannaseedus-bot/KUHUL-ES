#!/usr/bin/env node
'use strict';

/*
 * KUHUL-ES CLI
 * Version Integrity + Trace Artifact
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { program } = require('commander');

// -----------------------------------------------------------------------------
// Version (single source of truth)
// -----------------------------------------------------------------------------
const pkg = require('../package.json');

// -----------------------------------------------------------------------------
// Banner
// -----------------------------------------------------------------------------
console.log(`
╔══════════════════════════════════════╗
║        KUHUL-ES v${pkg.version}               ║
║  ECMAScript syntax, KUHUL semantics  ║
╚══════════════════════════════════════╝
`);

// -----------------------------------------------------------------------------
// CLI Definition
// -----------------------------------------------------------------------------
program
  .name('kuhul-es')
  .description('KUHUL-ES - The Trojan Horse for KUHUL semantics')
  .version(pkg.version);

// -----------------------------------------------------------------------------
// init
// -----------------------------------------------------------------------------
program
  .command('init [project-name]')
  .description('Initialize a new KUHUL-ES project')
  .action((projectName = 'my-kuhul-app') => {
    console.log(`Creating project: ${projectName}`);
    console.log('Use `kuhul-es new <name>` for full scaffold');
    process.exit(0);
  });

// -----------------------------------------------------------------------------
// new (FULL PROJECT SCAFFOLD)
// -----------------------------------------------------------------------------
program
  .command('new <name>')
  .description('Create a new KUHUL-ES project from template')
  .action((name) => {
    console.log(`Creating project: ${name}`);

    fs.mkdirSync(name, { recursive: true });

    const template = `
π config = {
  name: "${name}",
  version: "1.0.0",
  author: "${process.env.USERNAME || 'Developer'}"
};

τ frame = 0;

function* main() {
  yield* Sek('log', \`🚀 Starting \${config.name} v\${config.version}\`);

  @for (let i = 0; i < 5; i++) {
    yield* Sek('log', \`Frame: \${frame}\`);
    frame += 1;
    yield* Sek('wait', 100);
  }

  yield* Sek('log', '✅ Project ready!');
}

main();
`.trim();

    fs.writeFileSync(path.join(name, 'main.kuhules'), template);

    const packageJson = {
      name,
      version: '1.0.0',
      private: true,
      scripts: {
        start: 'kuhul-es run main.kuhules',
        dev: 'kuhul-es run main.kuhules --record'
      },
      dependencies: {
        'kuhul-es': `^${pkg.version}`
      }
    };

    fs.writeFileSync(
      path.join(name, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    console.log(`✓ Project created: ${name}`);
    console.log(`  cd ${name}`);
    console.log(`  npm install`);
    console.log(`  npm start`);
    process.exit(0);
  });

// -----------------------------------------------------------------------------
// compile — KUHUL-ES source -> canonical KAST (.kson, protocol kast/1)
program
  .command('compile <input>')
  .description('Compile KUHUL-ES source to canonical KAST (.kson, protocol kast/1)')
  .option('-o, --output <file>', 'Output .kson file')
  .option('--driver', 'Emit with a @driver contract (provider binding)')
  .option('--driver-only', 'Emit driver-only KAST (secure admission surface: capabilities + phase hooks, application body stripped)')
  .option('--provider <id>', 'Provider id for the @driver contract')
  .action((input, options) => {
    const parserPath = path.join(__dirname, '..', 'compiler', 'src', 'parser.js');
    const { KUHULParser, toKast } = require(parserPath);
    const abs = path.resolve(process.cwd(), input);
    const source = fs.readFileSync(abs, 'utf8');
    const prog = new KUHULParser(source, path.basename(input)).parse();
    const kast = toKast(prog, path.basename(input), {
      driver: !!options.driver,
      driverOnly: !!options.driverOnly,
      provider: options.provider || undefined,
    });
    const out = options.output || path.join(path.dirname(abs), path.basename(input, path.extname(input)) + '.kson');
    fs.writeFileSync(out, JSON.stringify(kast, null, 2));
    console.log('compiled: ' + input + ' -> ' + out);
    const nodeCount = Array.isArray(kast.nodes) ? kast.nodes.length : 0;
    const edgeCount = Array.isArray(kast.edges) ? kast.edges.length : 0;
    console.log('  protocol=' + kast.protocol + '  nodes=' + nodeCount +
      '  edges=' + edgeCount + '  @driver=' + ('@driver' in kast));
    process.exit(0);
  });

// run
// -----------------------------------------------------------------------------
program
  .command('run <file>')
  .description('Run a KUHUL-ES program through the deterministic runtime + physics engine')
  .option('--record', 'Record deterministic execution trace to trace.json')
  .option('--replay <trace>', 'Replay from a recorded trace file')
  .option('--physics-out <file>', 'Write physics history JSON after run')
  .option('--thoughts-out <file>', 'Write thinking-engine trace JSON after run')
  .action(async (file, options) => {
    console.log(`▶ Running: ${file}`);

    const absFile = path.resolve(process.cwd(), file);
    const source = fs.readFileSync(absFile, 'utf8');

    const { KUHULRuntimeNode } = require(path.join(__dirname, '..', 'runtime', 'src', 'node.js'));
    const rt = new KUHULRuntimeNode();

    if (options.record) {
      rt.on('hash', ({ frame, hash }) => {
        // nothing extra; hash chain is already deterministic
      });
    }

    await rt.execute(source);

    const trace = {
      version: pkg.version,
      file,
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      timestamp: new Date().toISOString(),
      frames: rt.frame,
      hashChain: rt.hashChain,
      physicsHistoryLength: rt.physics.history.length,
      thoughtCount: rt.thinker.thoughts.length,
    };
    trace.hash = crypto.createHash('sha256').update(JSON.stringify(trace)).digest('hex');

    if (options.record) {
      const outPath = path.resolve(process.cwd(), 'trace.json');
      fs.writeFileSync(outPath, JSON.stringify(trace, null, 2));
      console.log('trace.json written');
      console.log(`trace hash: ${trace.hash}`);
    }

    if (options.replay) {
      const replayPath = path.resolve(process.cwd(), options.replay);
      const oldTrace = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
      const expectedHash = crypto.createHash('sha256')
        .update(JSON.stringify({ ...oldTrace, hash: undefined })).digest('hex');
      if (oldTrace.hash !== expectedHash) {
        console.error('Trace hash mismatch');
        process.exit(1);
      }
      console.log('Trace verified');
      console.log(`trace hash: ${oldTrace.hash}`);
    }

    if (options.physicsOut) {
      fs.writeFileSync(path.resolve(process.cwd(), options.physicsOut), JSON.stringify(rt.physics.history, null, 2));
      console.log(`physics history written: ${options.physicsOut}`);
    }

    if (options.thoughtsOut) {
      fs.writeFileSync(path.resolve(process.cwd(), options.thoughtsOut), JSON.stringify(rt.thinker.thoughts, null, 2));
      console.log(`thoughts trace written: ${options.thoughtsOut}`);
    }

    console.log(`✓ Execution complete: ${rt.frame} frames, ${rt.hashChain.length} hashes, ${rt.thinker.thoughts.length} thoughts`);
    process.exit(0);
  });

// -----------------------------------------------------------------------------
// train — GLSL trainer (semantic skeleton + physics + GLSL kernels)
program
  .command('train <config>')
  .description("Train a semantic-skeleton net with the K'UHUL physics engine (GLSL kernels probed)")
  .option('--glsl-endpoint <url>', 'json_runtime glsl_gpu sidecar endpoint', 'http://127.0.0.1:8787')
  .option('--out <file>', 'Write the trained skeleton to a .json file')
  .option('--semantic', 'Enable semantic trainer advisor (reasons over folds/nodes/metrics)')
  .option('--semantic-interval <n>', 'Run semantic analysis every n epochs', '1')
  .action(async (configFile, options) => {
    const { GLSLTrainer, glslHttpTransport } = require(path.join(__dirname, '..', 'runtime', 'src', 'trainer.js'));
    const { SemanticTrainer } = require(path.join(__dirname, '..', 'runtime', 'src', 'trainer_semantic.js'));
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (e) {
      console.error('config error:', e.message);
      process.exit(1);
    }
    const cfgFile = path.basename(configFile);
    const trainerOpts = {
      inputDim: cfg.inputDim ?? 2,
      hiddenDim: cfg.hiddenDim ?? 40,
      outputDim: cfg.outputDim ?? 1,
      lr: cfg.lr ?? 0.2,
      steps: cfg.steps ?? 500,
      momentum: cfg.momentum ?? 0.9,
      transport: glslHttpTransport(options.glslEndpoint),
      verbose: true,
    };
    if (options.semantic) {
      trainerOpts.semanticTrainer = new SemanticTrainer({ interval: parseInt(options.semanticInterval, 10) || 1 });
    }
    const trainer = new GLSLTrainer(trainerOpts);
    const dataset = (cfg.dataset === 'sin')
      ? Array.from({ length: cfg.samples ?? 80 }, (_, i) => {
          const x = (i / (cfg.samples ?? 80)) * 2 - 1;
          return { x: [x, x * x], y: [Math.sin(2 * Math.PI * x) + (cfg.offset ?? 0.5)] };
        })
      : cfg.data.map(d => ({ x: d.x, y: d.y }));
    console.log('');
    console.log('GLSL trainer: ' + cfgFile + '  (' + dataset.length + ' samples, ' + trainer.hiddenDim + ' hidden)');
    const r = await trainer.train(dataset);
    if (options.out) {
      const skeleton = trainer.model();
      skeleton.config = { source: cfgFile, inputDim: cfg.inputDim ?? 2, hiddenDim: cfg.hiddenDim ?? 40 };
      fs.writeFileSync(options.out, JSON.stringify(skeleton, null, 2));
      console.log('model skeleton written: ' + options.out + ' (' + skeleton.nodes.length + ' nodes, ' + skeleton.edges.length + ' edges)');
    }
    console.log('final loss: ' + r.finalLoss.toFixed(6) + ' | GLSL: ' + (r.gpu ? 'ACTIVE' : 'CPU fallback') +
      (options.semantic ? ' | semantic advice epochs: ' + r.semanticAdvice.length : ''));
  });

// ---------------------------------------------------------------------------
// gpu — probe GPU / GLSL backends
// ---------------------------------------------------------------------------
program
  .command('gpu')
  .description('Probe available GLSL compute backends and kernel sources')
  .option('--glsl-endpoint <url>', 'json_runtime glsl_gpu sidecar endpoint', 'http://127.0.0.1:8787')
  .option('--kernel-out <dir>', 'Write GLSL kernel source files to a directory')
  .action(async (options) => {
    const { GLSLTrainer, glslHttpTransport } = require(path.join(__dirname, '..', 'runtime', 'src', 'trainer.js'));
    const { MATMUL, GELU, LAYERNORM } = require(path.join(__dirname, '..', 'runtime', 'src', 'glsl_kernels.js'));

    console.log('KUHUL GPU Probe\n');

    const kernels = [
      { name: 'matmul', source: MATMUL },
      { name: 'gelu', source: GELU },
      { name: 'layernorm', source: LAYERNORM },
    ];

    for (const k of kernels) {
      console.log(`Kernel ${k.name}: ${k.source.length} chars`);
    }

    if (options.kernelOut) {
      fs.mkdirSync(options.kernelOut, { recursive: true });
      for (const k of kernels) {
        fs.writeFileSync(path.join(options.kernelOut, `${k.name}.glsl`), k.source);
      }
      console.log(`\nKernel sources written to: ${options.kernelOut}`);
    }

    // Try a real remote compile via the transport
    const trainer = new GLSLTrainer({
      inputDim: 2, hiddenDim: 8, outputDim: 1,
      transport: glslHttpTransport(options.glslEndpoint),
      verbose: false,
    });
    const probe = await trainer.probeGLSL();

    console.log('\nRemote probe:');
    console.log('  endpoint:', options.glslEndpoint);
    console.log('  gpu:', probe.gpu ? 'ACTIVE' : 'UNAVAILABLE');
    if (probe.kernels) {
      for (const k of probe.kernels) {
        console.log(`  ${k.glyph}: ${k.compiled ? 'compiled' : 'failed'}`);
      }
    }
    if (probe.reason) console.log('  reason:', probe.reason);

    process.exit(0);
  });

// -----------------------------------------------------------------------------
// kxml — KHANARY KXML model runner
// -----------------------------------------------------------------------------
program
  .command('kxml')
  .description('Run KHANARY KXML model inference + chat templates')
  .option('--stb <path>', 'STB weights file')
  .option('--manifest <path>', 'Model manifest JSON (khanary-model-stb/v1)')
  .option('--run', 'Run a single forward pass and print output shape')
  .option('--generate <n>', 'Greedy generate n tokens from BOS', '0')
  .option('--chat', 'Render a sample KXML dialogue via Jinja chat template')
  .option('--prompt <text>', 'User prompt for --chat')
  .option('--kast-out <path>', 'Write semantic KAST trace of the forward graph')
  .option('--template-out <path>', 'Write KXML chat_template.json + .jinja')
  .option('--verify-hf', 'Verify HuggingFace model artifacts and optionally launch helper services (micronauts, llama-py-server.bat, AtomicDAG.bat)')
  .action(async (options) => {
    const { KxmlModel, emitTemplate } = require(path.join(__dirname, '..', 'runtime', 'src', 'kxml_driver.js'));
    const { toJinja, renderForGguf } = require(path.join(__dirname, '..', 'runtime', 'src', 'kxml_chat.js'));

    // Emit template artifacts
    if (options.templateOut) {
      fs.mkdirSync(options.templateOut, { recursive: true });
      fs.writeFileSync(path.join(options.templateOut, 'kxml_chat_template.json'),
        JSON.stringify(emitTemplate(options.templateOut), null, 2));
      fs.writeFileSync(path.join(options.templateOut, 'kxml_chat_template.jinja'), toJinja() + '\n');
      console.log(`KXML chat template written to ${options.templateOut}`);
      if (!options.stb) process.exit(0);
    }

    if (!options.stb || !options.manifest) {
      console.error('Usage: kuhul-es kxml --stb <weights.stb> --manifest <manifest.json> [--run | --generate N | --chat]');
      process.exit(1);
    }

    // Optional verification step that can spawn local helper services or CLI tools
    if (options.verifyHf) {
      console.log('[kxml] --verify-hf enabled: attempting environment verification and helper startup');

      const runSync = (cmd, args = [], opts = {}) => {
        try {
          console.log(`[kxml] running: ${cmd} ${Array.isArray(args) ? args.join(' ') : args}`);
          const res = spawnSync(cmd, Array.isArray(args) ? args : [args], Object.assign({ stdio: 'inherit', shell: true, timeout: opts.timeout || 120000 }, opts));
          if (res.error) {
            console.error(`[kxml] spawn error: ${res.error.message}`);
            return false;
          }
          if (res.status !== 0) {
            console.error(`[kxml] exited with status: ${res.status}`);
            return false;
          }
          return true;
        } catch (e) {
          console.error('[kxml] runSync exception:', e.message);
          return false;
        }
      };

      const findCandidate = (candidates) => {
        for (const c of candidates) {
          try {
            const p1 = path.resolve(process.cwd(), c);
            if (fs.existsSync(p1)) return p1;
            const p2 = path.resolve(__dirname, '..', c);
            if (fs.existsSync(p2)) return p2;
          } catch (e) { /* ignore */ }
        }
        // fallback to bare command name (may be on PATH)
        return candidates[0];
      };

      // 1) micronauts (CLI / runtime helper)
      const micronautsCmd = findCandidate(['micronauts', 'micronauts.bat', './micronauts.bat']);
      const micronautsOk = runSync(micronautsCmd, ['--version'], { timeout: 30000 });
      if (!micronautsOk) console.warn('[kxml] micronauts not available or returned non-zero');

      // 2) llama-py server (typical Windows helper)
      const llamaCmd = findCandidate(['llama-py-server.bat', './llama-py-server.bat', 'llama-py-server']);
      const llamaOk = runSync(llamaCmd, [], { timeout: 120000 });
      if (!llamaOk) console.warn('[kxml] llama-py-server not started or missing');

      // 3) AtomicDAG helper
      const dagCmd = findCandidate(['AtomicDAG.bat', './AtomicDAG.bat', 'AtomicDAG']);
      const dagOk = runSync(dagCmd, [], { timeout: 60000 });
      if (!dagOk) console.warn('[kxml] AtomicDAG helper not started or missing');

      console.log('[kxml] verification phase complete (warnings may indicate missing helpers)');
    }

    const model = await KxmlModel.fromFiles(options.stb, options.manifest);
    console.log(`[kxml] ${model.cfg.arch || 'model'}  ${model.cfg.n_layer || '?'}L  n_embd=${model.cfg.n_embd}  vocab=${model.cfg.vocab}`);
    console.log(`[kxml] graph: ${model.graph.length} glyphs  weights: ${Object.keys(model.W).length} tensors`);

    if (options.chat) {
      const chatTemplate = toJinja();
      const messages = [
        { role: 'system', content: 'You are a concise KUHUL assistant.' },
        { role: 'user', content: options.prompt || 'hello' },
      ];
      const prompt = renderForGguf(messages, chatTemplate, { addGenerationPrompt: true });
      console.log('\n--- KXML chat prompt ---\n');
      console.log(prompt);
      console.log('\n--- semantic KAST trace ---');
      model.forward([model.cfg.bos_token || 50256]);
      console.log(JSON.stringify(model.toKast().nodes.map(n => `${n.id}: ${n.glyph} -> fold ${n.fold}`), null, 2));
    }

    if (options.run) {
      const bos = model.cfg.bos_token || 50256;
      const out = model.forward([bos]);
      console.log(`[kxml] forward output shape: [${out.shape.join(', ')}]`);
    }

    const genCount = parseInt(options.generate, 10);
    if (genCount > 0) {
      const bos = model.cfg.bos_token || 50256;
      const tokens = model.generate([bos], genCount, true);
      console.log('[kxml] generated tokens:', tokens.join(' '));
    }

    if (options.kastOut) {
      fs.writeFileSync(options.kastOut, JSON.stringify(model.toKast(), null, 2));
      console.log(`[kxml] KAST trace written: ${options.kastOut}`);
    }

    process.exit(0);
  });

// -----------------------------------------------------------------------------
// doctor
// -----------------------------------------------------------------------------
program
  .command('doctor')
  .description('Run environment diagnostics for KUHUL-ES')
  .action(() => {
    console.log('KUHUL-ES Doctor\n');

    console.log('Version:', pkg.version);
    console.log('Node:', process.version);
    console.log('Platform:', process.platform);
    console.log('CLI path:', __filename);
    console.log('CWD:', process.cwd());

    try {
      require.resolve('commander');
      console.log('Commander: OK');
    } catch {
      console.log('Commander: MISSING');
      process.exit(1);
    }

    console.log('\nDiagnostics complete');
    process.exit(0);
  });

// -----------------------------------------------------------------------------
// Parse
// -----------------------------------------------------------------------------
program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
