> Status: live notes after 2026-08-08 review + implementation pass.
> Bold items were fixed in this pass.

# Gaps Found

1. **`kuhul-es run` was a stub** — it printed "Execution complete (stub)" and never executed the program or physics. **Fixed**: `run` now loads `KUHULRuntimeNode`, executes source, records trace, and can write physics/thoughts JSON.

2. **`src/index.js` was a PowerShell script** instead of a Node entry point. **Fixed**: it now exports the runtime, physics, trainer, and thinking engine.

3. **Module-system schizophrenia** — `compiler/src/*.js` were ESM with `import` while the rest of the package was CommonJS. Node had to dynamically reparse files, producing warnings and brittle behavior. **Fixed**: converted `parser.js` and `driver-kast.js` to CommonJS; CLI uses `require()`.

4. **Missing `npm` scripts** — no `test`, `build`, or `start`. **Fixed**: added all three.

5. **Version drift** — directory `1.0.18`, `package.json` `1.0.24`, README `1.0.0`. **Fixed**: bumped to `1.1.0` and updated README banner.

6. **Runtime parsers are regex-based and fragile** — they do not evaluate JS expressions. **Fixed**: replaced with AST-based runtime parser (`RuntimeParser` + `ExpressionEvaluator`). String concatenation, variable references, `Math.*`, and object literals now work.

7. **Browser entry undefined** — no browser manifest or declared entry points. **Fixed**: added `browser.manifest.json` with Node/browser/worker/service-worker entry points, optional WASM deps, KXML capabilities, and file whitelist.

8. **Browser and Node runtimes duplicated and diverged** (`runtime/src/browser.js` vs `runtime/src/node.js`). **Fixed**: extracted an isomorphic `runtime/src/core.js`; `browser.js` and `node.js` are now thin adapters. `sw.js` imports the same core, so browser + Node + service worker share one execution engine.

9. **Documented CLI command `kuhul-es kxml run` not implemented** — and no KXML runtime in the package. **Fixed**: implemented `kxml` CLI + JavaScript KXML inference driver (`KxmlModel`), STB reader, Jinja chat template renderer, and bundled KXML assets (`kxml/`). Models map to K'UHUL folds/nodes at runtime.

9. **TypeScript sources are out of sync** with the shipped `.js` files and do not compile without a `tsconfig.json`. **Partially fixed**: `runtime/src/fold-engine.ts` is now the canonical TypeScript source for the fold engine and compiles to CJS/ESM via `npm run build:fold`. Compiler TypeScript sources (`compiler/src/parser.ts`, `compiler/src/driver-kast.ts`) remain stale relative to their `.js` equivalents and still fail `tsc` due to top-level `import` placement and missing declarations.

10. **No error reporting with line numbers** for runtime parse/execute failures.

# Updates Implemented

- **Thinking Engine** (`runtime/src/think.js`, `Noj` glyph, `Sek('think', …)` alias):
  - Bounded, deterministic, pattern-directed reasoning.
  - Thoughts are KAST-like nodes with `fold`, `opcode: 'INFERE'`, and SHA-256 hashes.
  - Supports controlled rule/belief learning and reflection.
  - Integrated with `KuhulPhysics.reflect()` phase hook.

- **Fold engine (TypeScript reference)** (`runtime/src/fold-engine.ts`):
  - Vertical fold / linear node geometry matching `kfold/1` schema (`schemas/kfold-1.json`).
  - Explicit phases: `compressed → expanding → expanded → collapsing → collapsed`.
  - Async latent functions, parent pointers, deterministic depth, EventEmitter events.
  - `toJSON()` emits `kfold/1`; `toKast()` maps the same graph to `kast/1`.
  - Compiled to CommonJS and ESM via `npm run build:fold`; consumed by `core.js` and `core.mjs`.

- **Token/embedding LM training** (`runtime/src/trainer.js`, `runtime/src/tokenizer.js`, `runtime/src/text_dataset.js`):
  - GLSL trainer supports `vocabSize` + `embedDim` token mode.
  - Embedding lookup, layer norm, GELU FFN, LM head, stable softmax cross-entropy.
  - Sparse embedding gradients, greedy/top-k `generate()`.
  - Char-level tokenizer fallback when `@huggingface/tokenizers` is not installed.
  - Exported KAST manifest references external `model-weights/*.bin` artifacts and includes tokenizer metadata.

- **CLI execution** now actually runs code and emits:
  - deterministic hash chain
  - physics history
  - thought trace

- **Tests** added:
  - `test/think.test.js` covers the engine and runtime integration.
  - `test/driver-kast.test.js` converted to CommonJS for consistency.

- **Pattern Reasoner** (`runtime/src/pattern_reasoner.js`) — PCRE2-compatible regex rules with native-RegExp fallback, timeout wrapper, and backreference support for KAST propositions.
- **Pattern rules in the thinking engine** — `learnPatternRule()` loads regex rules; `think()` runs them against every belief.
- **Semantic Training Advisor** (`runtime/src/trainer_semantic.js`) — reasons over GLSL trainer skeletons (folds/nodes/metrics) and emits optimizer advice.

- **Isomorphic core runtime** (`runtime/src/core.js`) merges the browser and Node paths. `runtime/src/node.js` and `runtime/src/browser.js` are now thin platform adapters.
- **Service Worker + PWA** (`sw.js`, `index.html`, `manifest.webmanifest`):
  - `sw.js` precaches runtime assets and provides an offline `KUHUL_EXECUTE` message channel.
  - `sw.js` now attempts to load an optional PCRE2 WASM loader and broadcasts health to clients.
  - `index.html` shows PCRE2 availability in the header and can query the SW for health.
  - `index.html` uses `browser.js` directly when the SW is not yet registered, and delegates to the SW when registered.
  - `manifest.webmanifest` enables installability.

- **Browser manifest** (`browser.manifest.json`) — declares entry points, optional WASM deps, KXML capabilities, and file whitelist.

- **PCRE2 WASM helper**:
  - `scripts/copy-pcre2.js` — helper to copy `@ofjansen/pcre2-wasm` distribution files into `./pcre2/`.
  - `npm run build:pcre2` will run the helper script. The SW prefers `./pcre2/pcre2.js` when present and will initialize it automatically.
  - A minimal shim is shipped under `pcre2/pcre2.js` for local dev; running the build script overwrites the shim with the real distribution if installed.
- **KXML runtime** (`runtime/src/kxml_driver.js`, `runtime/src/stb_reader.js`, `runtime/src/kxml_chat.js`, `kxml/`):
  - Loads KHANARY `.stb` weights + manifest.
  - Walks `forward_graph` and executes glyphs with pure-JS kernels.
  - Maps every graph step to a KAST node with fold/opcode/symbol.
  - Renders KXML chat templates via a minimal Jinja engine.
  - Bundles KXML node/alignment/chat-template assets.

- **CLI** now implements:
  - `kuhul-es kxml` — model forward, generation, chat, KAST trace export
  - `kuhul-es gpu` — GLSL probe
  - `kuhul-es train --semantic` — live semantic advisor
  - `kuhul-es train <text.json> --out model.kson` — token-mode embedding LM

- **AST-based runtime parser** (`runtime/src/runtime_parser.js`, `runtime/src/expression_evaluator.js`) replaces fragile regex parsing.
- **Semantic training advisor** integrated into `GLSLTrainer.train()`; advice dynamically adjusts LR, pressure, and attention.

- **Package metadata** cleaned up (`package.json`, `README.md`).
- **Build step** added: `npm run build:fold` compiles the TypeScript FoldEngine to CJS/ESM.

# Similar Ideas to Improve Semantics

1. **Intent Parser / Constraint Engine** — before execution, collapse a natural-language intent into a constrained π-field plan (like KUHUL π but for user goals). Bound the search space and emit a KAST plan node.

2. **Semantic Diff / Replay** — compare two execution traces by their hash chains; replay from a saved state and detect drift. Useful for regression tests of semantic behavior.

3. **Policy-Enforcement Sidecar** — a small validator that checks every emitted KAST node against an allowlist of folds/opcodes/resources before execution (runtime equivalent of driver-only admission).

4. **Entropy-Guided Scheduling** — use the physics engine to dynamically order glyphs: when entropy is high, prefer `Xul`/`Ch'en` consolidation; when attention is high, prefer `Sek` execution.

5. **Symbolic Memory / π-Tape** — a typed, hash-chained store for π-bindings with provenance (who bound it, in which frame, under what hash).

6. **Ramble Engine Bridge** — a contained adapter that feeds the deterministic collapse result into a non-authoritative narrator, exactly as specified in `ramble_engine_spec.md`, without allowing narration to feed back into π.

7. **Contract-Aware Compiler** — make `--driver` derive not just capabilities but actual resource bounds from static analysis of the source (loop counts, tensor shapes, buffer sizes).

8. **GLSL transport fallback** — the trainer already has a transport abstraction; wire it into `kuhul-es gpu` so the CLI can probe and report backend availability.

---

# Latest Updates (2026-08-10)

- **Causal self-attention in GLSLTrainer** (runtime/src/attention.js, runtime/src/trainer.js):
  - Adds optional nHead/headDim attention to token-mode skeletons.
  - Forward/backward through multi-head causal self-attention.
  - New test: test/trainer_attention.test.js.

- **KXML -> kfold/1 mapping** (runtime/src/kxml_driver.js):
  - KxmlModel.toKast() now emits a kfold/1 graph with vertical folds, linear nodes, operands, and control unfolds.
  - New test: test/kxml_folds.test.js.

- **Browser / API chat bridge** (runtime/src/chat_bridge.js + .mjs, sw.js):
  - ChatBridge routes OpenAI-style chat.completions through the local semantic engine.
  - KXML/Jinja prompt rendering and tool-aware response generation.
  - Service worker intercepts POST /v1/chat/completions for offline chat.
  - New test: test/chat_bridge.test.js.

- **KUHUL-E domain response engine** (runtime/src/kuhul-e.js + .mjs, runtime/src/domain-stack.js, runtime/src/response-pattern.js):
  - Stack-specific domains, pattern matching, attention-weighted research hooks, fold-based response expansion, and feedback-driven learning.
  - Exports kfold/1 graphs via toKast() and round-trips knowledge with exportKnowledge() / importKnowledge().
  - New example: examples/kuhul-e-demo.js; new test: test/kuhul-e.test.js.

- **Backend transports** (runtime/src/transports/):
  - powernautGlslTransport maps KUHUL-ES kernels to the Powernaut GLSL Object Server opcodes (WO_DENSE, WO_RMS_NORM, WO_SOFTMAX, WO_GEGLU, etc.) and builds its /dispatch / /chain JSON envelope.
  - xvmD3d12Transport stubs shell-out access to the XVM D3D12 native stack. Compatible XVM D3D12 binaries are copied into bin/xvm-d3d12/ and archived into bin/bin.zip for npm.
  - kuhul-es gpu and kuhul-es train accept --backend powernaut-glsl|xvm-d3d12|glsl plus --backend-endpoint / --backend-manifest.
  - New test: test/transports.test.js; uses an in-process mock GLSL server so the suite stays self-contained. A compatible GLSL_Server.exe binary, server.glsl.json manifest, neural_layer.glsl shader, and XVM D3D12 binaries are copied into bin/ for local use. For npm publishing the raw .exe/.dll files are packed into bin/bin.zip and excluded from the tarball via bin/.npmignore; users run `npm run extract-bin` to restore them.

- **Unified runtime** (`runtime/src/unified.js` + `.mjs`, `test/unified.test.js`):
  - New `KuhulRuntime` class integrates DOM, DAG, Graph, RAG, and HaaB patterns.
  - Top-level `kuhul.execute(source, controls)` dispatches through Micronaut/KUHUL π/Extrapolator control methods.
  - `KastEngine` validates KAST/1 nodes and edges.
  - `KxmlEngine` executes forward-graph layers in DAG order with output aliasing.
  - SCXQ2 compression is used as a validity proof after the full pipeline.
  - New test: `test/unified.test.js`.

- **SCXQ2 compression** (`runtime/src/scxq2.js`, `test/scxq2.test.js`): implements the grammar's `↻ 'scxq2'` law with round-trip, JSON-safe, and deterministic compression tests.

- **Test suite**: 142 tests / 26 suites pass (verified 2026-08-11; the suite previously hung on an uptime-timer leak in the micronaut runtime and never printed a summary).

---

# Latest Updates (2026-08-11)

- **Micronaut DAG execution fixed** (`runtime/src/micronaut.js`):
  - `_topologicalSort` returned post-order (children before parents), so every fold executed in reverse: no node received its parents' outputs and output nodes always resolved to `{}`. Reversed into dependency order.
  - `orchestrate()` now surfaces the task via `context.input`, so DAG input nodes expose the task.
  - `_executeProcess` hands tools `{ ...parentOutputs, ...taskFields }` plus flattened `{ value: X }` payloads, so tools written against the task shape (`input.spec`, `input.code`, `input.assessment`) work.
  - Result contract unified: `_executeFold` returns `{ output: <first output node result>, ...nodeIds }` — `result.output` / `result.output.value` now hold for any fold regardless of output-node naming.
- **Uptime timer leak fixed**: `Micronaut._updateUptime()` scheduled an unbounded recursive `setTimeout` while status was `running`, with no `clearTimeout` anywhere — any micronaut left running kept the Node process alive forever. This is why `npm test` hung after the domains suite and never printed a summary. `stop()`/`start()` now clear the timer; `resume()` restarts the chain; domain adapters wrap each call in `start() → orchestrate() → stop()`.
- **Action-aware routing**: `_selectFold` now prefers a fold whose name or `metadata.actions` matches `task.action` before falling back to the routing strategy. Domain folds gained `metadata.actions`; added the missing `code_optimize`, `summarize`, and `translate` folds (wiring the previously-unused code-optimize tool); the assessment fold gained a `map_assessment` transform node.
- **Parser cleanup**: removed the dead `/^(τ|tau)\s+/` branch in `runtime_parser.js` `extractTauUpdates` (a regex that can never match an identifier).
- **Test suite**: now **142 tests / 26 suites pass** with a clean exit (~2s). `test/domains.test.js` went from 2/10 passing (8 failures, two with 3s retry stalls) to 10/10 in ~130ms.
- **Still open**: line-numbered runtime error reporting (gap #10); `tsc --noEmit` hangs in this environment (unverified, not micronaut code); the micronaut subsystem and most recent runtime files remain untracked in git; `KUHUL-PI/` is an empty directory; a stray `nul` file sits at repo root.
