# GitHub Copilot instructions for KUHUL-ES

## Project overview

This repository is the Node.js package for K'UHUL-ES: a deterministic runtime + compiler for ECMAScript-like syntax with KUHUL semantics, phase-glyph execution, Micronaut orchestration, KXML inference, and training/runtime tooling.

The main runtime surface is exported from `src/index.js`, which re-exports the canonical package API. The package also ships dual CommonJS/ESM entrypoints and generated build artifacts under `runtime/src/`.

The important architectural split in this repo is:

- `bin/kuhul-es.js` is the CLI and operator entry point (`compile`, `run`, `train`, etc.).
- `compiler/src/parser.ts` / `compiler/src/parser.js` parse KUHUL source into canonical KAST.
- `runtime/src/core.js` is the isomorphic execution core: it owns π/τ bindings, glyph execution, physics, deterministic hash chaining, and event hooks.
- `runtime/src/unified.js` is the higher-level public runtime (`KuhulRuntime`, `KastEngine`, `KxmlEngine`, `kuhul.execute()`).
- `runtime/src/micronaut.js` and `runtime/src/micronaut_bridges.js` add orchestration, tool/agent routing, and XJSON-based control-plane behavior.
- `runtime/src/trainer*.js`, `runtime/src/kxml_driver.js`, and `runtime/src/kxml_chat.js` implement training/inference flows and templates.
- `grammars/`, `schemas/`, `docs/`, and `sw.khl` define the canonical semantics and control-plane contracts; they are not just documentation.

## Build, test, and validation commands

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

This runs `npm run build:fold`, which compiles `runtime/src/fold-engine.ts` into generated JS/ESM outputs via `scripts/build-fold-engine.js`.

Related build helpers that may be useful:

```bash
npm run build:fold
npm run build:pcre2
npm run extract-bin
```

### Test

```bash
npm test
```

This runs the Node test suite via `node --test test/*.test.js`.

Run a single file:

```bash
node --test test/core_runtime.test.js
```

Run a single test by name:

```bash
node --test --test-name-pattern "executes π/τ bindings with expression evaluation" test/core_runtime.test.js
```

### Lint

No lint script or dedicated lint configuration is currently defined in `package.json`.

### CLI smoke checks

```bash
node bin/kuhul-es.js --help
node bin/kuhul-es.js run path/to/file.kuhules
node bin/kuhul-es.js compile path/to/file.kuhules
```

## Semantic authority and canonical source-of-truth

This repo is a KUHUL-semantic runtime first, and all backends are projections. In practice that means:

- K'UHUL semantics are the authoritative layer; native, JS, GPU, and training paths are execution surfaces, not the source of truth.
- The canonical phase order remains `Pop → Wo → Yax → Sek → Ch'en → Xul`, with `Noj` as the reflective layer when used for deliberate self-inspection.
- JSON/XJSON and manifests are the operator/control plane; the compiler/runtime semantics remain the core law to preserve.
- Grammar and manifest files are source-of-truth artifacts. Prefer updating the semantic contract and parser/manifest logic together instead of duplicating routing tables or adding parallel, ad hoc definitions.
- Keep the Micronaut, KXML, and training paths bridged by explicit contracts, not by hidden coupling.

## Architecture and code paths to read together

When working in this repo, do not reason from a single file in isolation. The system is intentionally split across multiple layers:

- `package.json` defines the package surface and the runtime/CLI entrypoints.
- `src/index.js` is the public API aggregator; this is the most important root export file to inspect before changing a public surface.
- `runtime/src/core.js` contains the core execution model (`KUHULRuntimeCore`, `hashState`, glyph handlers, physics, thought engine).
- `runtime/src/unified.js` adds the top-level runtime abstraction and high-level orchestrator (`KuhulRuntime`, `KastEngine`, `KxmlEngine`, `kuhul.execute`).
- `compiler/src/parser.ts` + `bin/kuhul-es.js` show how source language and CLI map into KAST and execution.
- `runtime/src/micronaut.js` defines the agent/orchestration layer, including priority routing and XJSON manifest expectations.
- `runtime/src/micronaut_bridges.js` connects orchestration with transports and runtime bridges.
- `runtime/src/kxml_driver.js` + `runtime/src/kxml_chat.js` implement the KXML model execution and template-rendering path.
- `runtime/src/trainer.js`, `runtime/src/trainer_semantic.js`, `runtime/src/attention.js`, and related transport modules show the native/WebGL/XSHARD training integration path.
- `grammars/` and `schemas/` define the formal language and interchange contracts; keep changes aligned with them.

## Subsystem focus areas

### Micronaut / orchestration

This layer is not just an optional plugin; it is the control-plane and routing system for agents, tools, folds, and XJSON manifests.

Read together when changing Micronaut behavior:

- `runtime/src/micronaut.js` — registry, agent/fold/tool definitions, XJSON validation, and routing logic
- `runtime/src/micronaut_bridges.js` — bridge implementation and transport hooks
- `runtime/src/unified.js` — top-level runtime that coordinates higher-level orchestration
- `test/micronaut.test.js`, `test/micronaut_bridges.test.js`, `test/micronaut_xjson.test.js`

Key rule: XJSON is treated as the declarative control plane, not as a secondary config format. If you add or rename required sections, check the manifest expectations in `MICRONAUT_XJSON_REQUIRED_SECTIONS` and the corresponding tests.

### KXML / semantic model execution

KXML flows are model-graph execution paths, not ad hoc JSON. The runtime models KXML as a graph of layer operations (`embed`, `retrieve`, `transform`, `classify`, `generate`, `tool`) with a fold semantics trace.

Read together when changing KXML behavior:

- `runtime/src/kxml_driver.js` — pure-JS model execution and semantic node/fold mapping
- `runtime/src/kxml_chat.js` — chat template rendering / Jinja-style generation helpers
- `runtime/src/core.js` / `runtime/src/unified.js` — how KXML fits into the larger runtime lifecycle
- `test/kxml_driver.test.js`, `test/kxml_chat.test.js`, `test/kxml_folds.test.js`, `test/cli_kxml.test.js`

Important convention: semantic nodes are mapped back to KUHUL glyph/fold identities (`Pop`, `Wo`, `Sek`, `Xul`, etc.), so changes in KXML execution often need to maintain the fold semantics contract.

### Training / native / GLSL integration

The training path is intentionally multi-backend: WebGL2, native, XSHARD, and semantic trainer logic coexist. This repo expects the runtime and training logic to stay aligned with the same glyph/phase model.

Read together when changing training logic:

- `runtime/src/trainer.js` — high-level GLSL/native trainer and semantic node picks
- `runtime/src/trainer_semantic.js` — semantic trainer logic and training rules
- `runtime/src/attention.js` — attention/backprop kernels
- `runtime/src/glsl_kernels.js` — GPU-side kernels
- `runtime/src/transports/*.js` — backend transport implementations
- `test/cli_train_native.test.js`, `test/trainer_attention.test.js`, `test/trainer_semantic.test.js`, `test/trainer_token.test.js`, `test/cli_gpu.test.js`

Common pitfall: when changing glyph-to-train semantics or transport contracts, update the runtime expectations and their corresponding CLI or trainer tests together.

## Common edit workflows

### 1) Changing runtime semantics or glyph behavior

Typical files to inspect together:

- `runtime/src/core.js` — glyph execution and physics hooks
- `runtime/src/unified.js` — public runtime orchestration
- `src/index.js` — exports and public API surface
- relevant tests under `test/*.test.js`

Example workflow:

```bash
# inspect behavior and narrow test first
node --test test/core_runtime.test.js

# then patch the runtime core and, if needed, the exported API surface
```

When adding or renaming a phase/glyph mapping, update the canonical semantics contract and the runtime behavior together. Do not introduce a new glyph name without checking the phase model and fold mapping it is intended to serve.

### 2) Adding or changing Micronaut/XJSON behavior

Typical files to inspect together:

- `runtime/src/micronaut.js`
- `runtime/src/micronaut_bridges.js`
- `test/micronaut.test.js`
- `test/micronaut_xjson.test.js`

Example workflow:

```bash
# validate the control-plane contract before broad changes
node --test test/micronaut_xjson.test.js

# if new sections or required keys are added, update both the registry logic and xjson tests
```

Keep XJSON as the declarative envelope around runtime behavior; do not let it become the actual semantic oracle when the runtime and grammar define the canonical execution law.

### 3) Modifying KXML model execution or chat rendering

Typical files to inspect together:

- `runtime/src/kxml_driver.js`
- `runtime/src/kxml_chat.js`
- `test/kxml_driver.test.js`
- `test/kxml_chat.test.js`

Example workflow:

```bash
# use the smallest relevant KXML tests first
node --test test/kxml_driver.test.js
node --test test/kxml_chat.test.js
```

When adjusting graph/opcode behavior, verify the glyph-to-fold mapping still matches the intended semantic phase rather than only the function output.

### 4) Changing training or GPU transport behavior

Typical files to inspect together:

- `runtime/src/trainer.js`
- `runtime/src/trainer_semantic.js`
- `runtime/src/transports/*.js`
- `runtime/src/attention.js`
- `test/cli_train_native.test.js`
- `test/trainer_semantic.test.js`

Example workflow:

```bash
# test the trainer path with the closest targeted suite
node --test test/trainer_semantic.test.js
node --test test/cli_train_native.test.js
```

Keep the trainer bridge narrow: training logic should feed into the runtime contract, not silently change the semantics of the model engine itself.

### 5) Changing CLI behavior or source-to-KAST compilation

Typical files to inspect together:

- `bin/kuhul-es.js`
- `compiler/src/parser.ts`
- `test/driver-kast.test.js`
- `test/runtime_parser.test.js`

Example workflow:

```bash
# compile and runtime parser behavior are usually linked
node --test test/driver-kast.test.js
node --test test/runtime_parser.test.js
```

## Key conventions and repo-specific patterns

- Use the existing package interface rather than inventing parallel APIs. The root package exports are the source of truth for supported runtime behavior.
- This repo intentionally keeps TypeScript sources and runtime JavaScript in sync; the parser comment explicitly notes it is a TypeScript mirror of the canonical CommonJS implementation. Do not assume the TypeScript file is the only canonical implementation.
- The runtime is designed around canonical phase names: `Pop`, `Wo`, `Yax`, `Sek`, `Ch'en`, `Xul`, and `Noj`. These are semantic operation names, not arbitrary strings.
- `π` (immutable) and `τ` (temporal) bindings are first-class runtime concepts. Changes to binding semantics usually touch the core runtime and the parser together.
- `*.xjson` is treated as the control-plane / declarative manifest layer, while `*.stb` remains a binary/tensor payload and JSONL is used for corpora metadata. Keep that boundary intact when touching runtime configuration.
- It is normal for generated build artifacts to exist next to source files (`runtime/src/fold-engine.js`, `.mjs`, `.d.ts`). If a build step regenerates them, prefer updating the source and rebuilding rather than hand-editing generated outputs.
- Follow the existing repository patterns in `AGENTS.md`: keep changes focused and atomic, add or update tests for behavior changes, and document public APIs when adding exported runtime features.
- Treat grammar, schema, and manifest files as canonical contracts; avoid maintaining duplicate routing or fold tables when a manifest already exists.
- Keep training, runtime, and orchestration concerns separated by explicit contracts unless they are intentionally part of the same execution layer.

## Working style expectations

- Prefer reading the exported API and the closest runtime module together before patching behavior.
- Keep fixes minimal and aligned with existing execution semantics rather than layering new abstractions on top of the runtime.
- When changing runtime semantics or parser behavior, verify with the smallest relevant Node test file first.
- If a feature adds a public API surface, update the relevant export path and keep the top-level package entry consistent.
- When a change touches semantics, xJSON manifests, or phase mappings, update the corresponding model/training tests in the same patch.

## Relevant project docs

- `README.md` for the product and runtime overview.
- `AGENTS.md` for the repo's AI assistant guidance.
- `docs/` and `grammars/` for canonical semantic and language definitions.

- Use the existing package interface rather than inventing parallel APIs. The root package exports are the source of truth for supported runtime behavior.
- This repo intentionally keeps TypeScript sources and runtime JavaScript in sync; the parser comment explicitly notes it is a TypeScript mirror of the canonical CommonJS implementation. Do not assume the TypeScript file is the only canonical implementation.
- The runtime is designed around canonical phase names: `Pop`, `Wo`, `Yax`, `Sek`, `Ch'en`, `Xul`, and `Noj`. These are semantic operation names, not arbitrary strings.
- `π` (immutable) and `τ` (temporal) bindings are first-class runtime concepts. Changes to binding semantics usually touch the core runtime and the parser together.
- `*.xjson` is treated as the control-plane / declarative manifest layer, while `*.stb` remains a binary/tensor payload and JSONL is used for corpora metadata. Keep that boundary intact when touching runtime configuration.
- It is normal for generated build artifacts to exist next to source files (`runtime/src/fold-engine.js`, `.mjs`, `.d.ts`). If a build step regenerates them, prefer updating the source and rebuilding rather than hand-editing generated outputs.
- Follow the existing repository patterns in `AGENTS.md`: keep changes focused and atomic, add or update tests for behavior changes, and document public APIs when adding exported runtime features.

## Working style expectations

- Prefer reading the exported API and the closest runtime module together before patching behavior.
- Keep fixes minimal and aligned with existing execution semantics rather than layering new abstractions on top of the runtime.
- When changing runtime semantics or parser behavior, verify with the smallest relevant Node test file first.
- If a feature adds a public API surface, update the relevant export path and keep the top-level package entry consistent.

## Relevant project docs

- `README.md` for the product and runtime overview.
- `AGENTS.md` for the repo's AI assistant guidance.
- `docs/` and `grammars/` for canonical semantic and language definitions.
