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

9. **TypeScript sources are out of sync** with the shipped `.js` files and do not compile without a `tsconfig.json`.

10. **No error reporting with line numbers** for runtime parse/execute failures.

# Updates Implemented

- **Thinking Engine** (`runtime/src/think.js`, `Noj` glyph, `Sek('think', …)` alias):
  - Bounded, deterministic, pattern-directed reasoning.
  - Thoughts are KAST-like nodes with `fold`, `opcode: 'INFERE'`, and SHA-256 hashes.
  - Supports controlled rule/belief learning and reflection.
  - Integrated with `KuhulPhysics.reflect()` phase hook.

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

- **AST-based runtime parser** (`runtime/src/runtime_parser.js`, `runtime/src/expression_evaluator.js`) replaces fragile regex parsing.
- **Semantic training advisor** integrated into `GLSLTrainer.train()`; advice dynamically adjusts LR, pressure, and attention.

- **Package metadata** cleaned up (`package.json`, `README.md`).

# Similar Ideas to Improve Semantics

1. **Intent Parser / Constraint Engine** — before execution, collapse a natural-language intent into a constrained π-field plan (like KUHUL π but for user goals). Bound the search space and emit a KAST plan node.

2. **Semantic Diff / Replay** — compare two execution traces by their hash chains; replay from a saved state and detect drift. Useful for regression tests of semantic behavior.

3. **Policy-Enforcement Sidecar** — a small validator that checks every emitted KAST node against an allowlist of folds/opcodes/resources before execution (runtime equivalent of driver-only admission).

4. **Entropy-Guided Scheduling** — use the physics engine to dynamically order glyphs: when entropy is high, prefer `Xul`/`Ch'en` consolidation; when attention is high, prefer `Sek` execution.

5. **Symbolic Memory / π-Tape** — a typed, hash-chained store for π-bindings with provenance (who bound it, in which frame, under what hash).

6. **Ramble Engine Bridge** — a contained adapter that feeds the deterministic collapse result into a non-authoritative narrator, exactly as specified in `ramble_engine_spec.md`, without allowing narration to feed back into π.

7. **Contract-Aware Compiler** — make `--driver` derive not just capabilities but actual resource bounds from static analysis of the source (loop counts, tensor shapes, buffer sizes).

8. **GLSL transport fallback** — the trainer already has a transport abstraction; wire it into `kuhul-es gpu` so the CLI can probe and report backend availability.
