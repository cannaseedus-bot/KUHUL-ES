# KUHUL-ES
<img src=https://github.com/cannaseedus-bot/KUHUL-PI/blob/main/kuhulpi-micronaut.png>

```text
⟁ K'UHUL ⟁
Pop → Wo → Yax → Sek → Ch'en → Xul  (+ Noj: controlled reflection)
Canonical Semantic Runtime • KAST • KSON • Sidecars
```

## Binary ingest tooling

See `docs/binary_ingest.md` for the MATRIX / ATOMIC-DOM binary packer and
runtime read examples.
## Canonical grammar notes

See `kuhul_pi_grammar.ebnf` for the frozen canonical grammar,
`docs/cool_atomic_grammar.ebnf` for the C@@L (COOL) atomic block grammar, and
`docs/canonical_merge_v1_1.md` for the v1.1 compatibility/merge rationale.

## Micronaut + KHL kernel

The complete Micronaut and KHL kernel lives in `sw.khl`.

Upstream reference snapshot:
`https://raw.githubusercontent.com/cannaseedus-bot/KUHUL-PI/refs/heads/main/sw.khl`

## K-UX (projection layer)

See `docs/kux_v1_canonical.md` for the K-UX layer law and constraints, and
`docs/kux.schema.json` for the authoritative machine-readable canonical schema,
`tools/kux_verify.py` for deterministic conformance verification, and
`docs/kux_badge_spec.md` for compliance badge criteria.

# kuhul-es

**K'UHUL-ES: ECMAScript syntax with K'UHUL semantics.**

Deterministic, physics-first programming for JavaScript developers. Write K'UHUL
programs with `pi`/`tau` bindings and `yield*` glyph calls; execute through a
hash-chained runtime with a real K'UHUL physics engine.

## Features

- **Phase-glyph runtime**: `Pop → Wo → Yax → Sek → Ch'en → Xul` (+ `Noj` reflection)
- **Immutable `pi` and temporal `tau` bindings**
- **KAST/1** canonical semantic output + **KFOLD/1** lazy fold graphs
- **KXML inference driver** with tool-aware Jinja chat templates
- **Browser PWA** with service worker, offline chat, and PCRE2 regex support
- **KUHUL-E domain response engine** with stack-based domains and research hooks
- **Pluggable compute backends**: GLSL sidecar, Powernaut GLSL Server, XVM D3D12
- **Native binary archive** (`bin/bin.zip`) with `npm run extract-bin`
- **Unified runtime** `kuhul.execute()` combining DOM, DAG, Graph, RAG, and HaaB patterns
- **Formal grammars** under `grammars/`: K'UHUL π, KAST/1, KFOLD/1, KHL/1, XCFE/1, XJSON/1, KXML/1

## Unified runtime

`kuhul.execute(source, controls)` provides one API for DOM-like, DAG-like, graph,
RAG, and HaaB execution patterns. It dispatches through the locked control methods:

- `orchestrate: 'micronaut'` — selects and arranges contexts
- `enforce: 'kuhul_pi'` — executes phase glyphs and collapses to law
- `expand: 'extrapolator'` — produces metaphor/analogy/framing expansions

```js
const { kuhul, KuhulRuntime } = require('kuhul-es');

const result = await kuhul.execute(`
  [Pop "perceive" → "query"]
  [Yax "plan" → {"tools": ["search"]}]
  [Sek "execute" → { steps: ["retrieve_context", "apply_tools", "collapse_to_answer"] }]
  kxml chat "Answer question" with context
`, {
  orchestrate: 'micronaut',
  enforce: 'kuhul_pi',
  expand: 'extrapolator'
});
```

You can also construct `new KuhulRuntime({ mode: 'full' })` and load KAST ASTs or
KXML models directly:

```js
const runtime = new KuhulRuntime({ mode: 'full' });
runtime.loadKast({ protocol: 'kast/1', nodes: [...], edges: [...] });
runtime.loadKxml({ kind: 'kxml/model', forward: [...] });
const output = await runtime.execute({ query: '...' });
```

## Formal grammars

The `grammars/` directory contains the EBNF definitions for the K'UHUL-ES language surface and its satellite formats. They are included in the npm package.

| File | Purpose |
|------|---------|
| `grammars/kuhul-pi.ebnf` | K'UHUL π — ECMAScript syntax + phase glyphs + atomic blocks |
| `grammars/kast-1.ebnf` | KAST/1 — canonical semantic AST manifest |
| `grammars/kfold-1.ebnf` | KFOLD/1 — lazy fold graph |
| `grammars/khl-rom-1.ebnf` | KHL/1 — ROM block syntax used in `sw.khl` |
| `grammars/xcfe-1.ebnf` | XCFE/1 — control/flow/variable vector contracts |
| `grammars/xjson-1.ebnf` | XJSON/1 — semantic JSON with `@` metadata and atomic blocks |
| `grammars/kxml-1.ebnf` | KXML/1 — declarative inference graphs + chat templates |
| `grammars/xshard-1.ebnf` | XSHARD/1 — streaming shard manifest grammar |
| `schemas/xshard-1.json` | XSHARD/1 — JSON Schema for the binary manifest |

All grammars preserve the locked architectural boundary: Micronaut orchestrates, KUHUL π enforces, and Extrapolator expands without altering outcomes.

## XJSON micronaut hydration

Micronaut runtime now supports direct hydration from XJSON control blocks:

```js
const { MicronautFactory } = require('kuhul-es');

const { micronaut } = MicronautFactory.fromXjsonFile('model/agents/MM-1/MM-1.xjson', {
  stbPath: 'model/weights/MM-1.stb', // optional: attach STB tensor payload location
  datasetPath: 'data/train/ultrachat.jsonl', // optional: attach JSONL training corpus
});
```

`*.xjson` remains the authoritative control-plane definition. `*.stb` stays a tensor payload artifact (`stbPath`), and training corpora can be attached as JSONL metadata (`datasetPath`).

## XJSON runtime control plane

`kuhul-es` can treat XJSON as a no-JavaScript control manifest: modules,
state-machine transitions, conditional routes, MIME registry, DOM/component
rendering, curl automation, health checks, and K'UHUL/SCX runtime settings all
live in declarative JSON. That makes XJSON the operator/control layer while
K'UHUL handles phase law and the native runtime executes the side effects.

The native foundation is already built in the repository:

| Artifact | Purpose |
|----------|---------|
| `dist\json-runtime\build\Release\json_runtime.exe` | Manifest runner / object-server runtime |
| `dist\json-runtime\build\Release\json_runtime_lib.dll` | Native hosting API used by higher-level orchestration |
| `dist\json-runtime\build\Release\json_runtime_lib.lib` | MSVC import library for embedding the runtime |
| `dist\json-runtime\build\Release\json_runtime_lib.exp` | Export table emitted with the runtime library |

Recommended manifest shape:

```json
{
  "@manifest": {
    "@schema": "https://xjson.dev/schema/v1",
    "@type": "application/x-json-runtime",
    "@modules": {
      "@core": { "@exports": ["dns", "server", "mime", "curl"] },
      "@network": { "@exports": ["dns", "proxy", "ports"], "@dependencies": ["@core"] },
      "@runtime": { "@exports": ["kuhul", "scx", "vm"], "@dependencies": ["@core"] }
    },
    "@control": {
      "@flow": {
        "@type": "state-machine",
        "@states": {
          "uninitialized": { "@on": "bootstrap", "@transition": "initializing" },
          "initializing": { "@on": "ready", "@transition": "running" },
          "running": { "@on": "shutdown", "@transition": "terminating" },
          "terminating": { "@on": "complete", "@transition": "terminated" }
        }
      }
    },
    "@network": {
      "@server": {
        "@http": {
          "@port": 6000,
          "@mime": {
            "@default": "application/x-json+xhtml",
            "@registry": {
              ".xjson": "application/x-json+xhtml",
              ".xmanifest": "application/x-json-manifest",
              ".scx": "application/x-scx-compressed",
              ".kuhul": "application/x-kuhul-bytecode"
            }
          }
        },
        "@websocket": { "@port": 6001, "@protocols": ["xjson-ws", "kuhul-stream"] }
      }
    },
    "@runtime": {
      "@kuhul": {
        "@mode": "sandbox",
        "@glyphs": {
          "Pop": { "@type": "load", "@op": "fetch" },
          "Sek": { "@type": "compute", "@op": "transform" },
          "Wo": { "@type": "store", "@op": "persist" },
          "Kul": { "@type": "connect", "@op": "stream" }
        }
      },
      "@scx": { "@stream": true, "@verify": "checksum" }
    }
  }
}
```

Execution flow: bootstrap modules, configure DNS/proxy, start HTTP/WS services,
show splash/progress, initialize the K'UHUL VM and SCX stream, mount XJSON
components, expose API endpoints, run health checks, then gracefully terminate.
The important boundary is the same as the trainer stack: JSON/XJSON owns
declarative control, K'UHUL owns semantic phase law, and native binaries are
execution engines rather than the source of orchestration truth.

See `..\..\JSON-RUNTIME.md` for the full native artifact inventory and the
repo-local `programs\` registry (`actions.manifest.json`, `classes.manifest.json`,
`rpc.manifest.json`, `kuhul_dispatch.json`, `scxq2_tile_upload.json`, and related
runtime programs).

## Install

```bash
npm install kuhul-es
```

Dependencies: `commander` (MIT, the standard Node CLI parser — zero deps, open source).

## XSHARD trainer — automated shard-resident training

`train-xshard` is the operator-facing lane for `.xshard` models. It hides
manual shard/slice handling: the command copies the input model to an output
file, streams a token/data bin through the native backward scheduler, emits a
matching gradient `.xshard`, then applies the update with the D3D11 CS5
write-back kernel.

```powershell
node .\dist\kuhul-es\bin\kuhul-es.js train-xshard `
  --input .\trainer\test.xshard `
  --token-bin .\trainer\test.xshard `
  --output .\trainer\build\trained.xshard `
  --steps 1 --max-shards 1 --sgd --lr 0.01
```

Native flow per step:

```text
input.xshard -> output.xshard copy
output.xshard + token/data bin -> xshard_backward.exe -> stepN.grad.xshard
output.xshard + stepN.grad.xshard -> xshard_adapt.exe --apply -> trained shard state + ledger
```

Artifacts:

| Artifact | Purpose |
|----------|---------|
| `stepN.grad.xshard` | Matching gradient container preserving shard identity |
| `stepN.adapt.jsonl` | JSONL checkpoint/adaptation ledger |
| output `.xshard` | Updated model shard container with trained state bytes |

Options:

| Flag | Purpose |
|------|---------|
| `--steps <n>` | Repeat backward + adapt steps |
| `--max-shards <n>` | Bound resident F32 shard windows per step |
| `--fold <phase>` | Optional fold filter (`Pop`, `Wo`, `Yax`, `Sek`, `Chen`, `Xul`) |
| `--lr <v>` | Adapt learning rate |
| `--grad-scale <v>` | Token-signal gradient scale for the current proxy backward path |
| `--weight-scale <v>` | Weight-proportional gradient scale |
| `--sgd` | Use SGD instead of Adam in `xshard_adapt` |
| `--no-apply` | Dry-run adapt without mutating the output model |

Current status: the scheduler bridge and write-back path are wired and verified.
The remaining upgrade is replacing the deterministic token-signal gradient proxy
with true model-specific backward gradients over resident shard windows.

## WebGL2 trainer — full tensor, shard, and model sweep

`kuhul-es` bundles a WebGL2 GPU adaptation trainer that runs inside a browser
context orchestrated by `kuhul-server`. It streams bounded tensor passes over
the GPU without requiring full model residency in VRAM — one tensor at a time,
writing each result back before moving to the next.

**Model tiers:**

| Tier | Params | VRAM | First-class |
|------|--------|------|-------------|
| Mini GPT (GPT-2 small) | 117M — 12L/768d | ~230 MB F32 | ✓ primary target |
| Med GPT (GPT-2 medium) | 355M — 24L/1024d | ~680 MB F32 | ✓ primary target |
| gpt-oss (large/XL class) | 1B+ | needs headroom | optional — if VRAM allows |

Start here with mini or med. Use gpt-oss only when you have confirmed VRAM
headroom after the smaller models are adapted.

### Dashboard

```powershell
pwsh -STA -File .\dist\kuhul-es\tools\webgl2-trainer-dashboard.ps1
```

WPF GUI (Windows) with logo, server connection, session controls, and a live
event log. The dashboard is the XSHARD-first trainer surface: shard/window
movement stays internal to the scheduler. It also exposes HF tensor sweeps and
the native GPT lane from one operator panel.

| Button | Lane | Field mapping |
|--------|------|---------------|
| `Start XSHARD` | Automated `.xshard` trainer | Input/Output = `.xshard`; first Token bin = token/data stream; Tensor = optional fold; `max_shards=1` default |
| `Start HF Tensors` | HuggingFace `.safetensors` tensor sweep | Input/Output = `.safetensors`; first Token bin = packed tokens; Tensor = optional regex, default `\.weight$`; runs `train-webgl2-sweep --all-tensors` |
| `Start Native GPU` | Full-model GPT compatibility bridge | Input/Output = safetensors; first Token bin = data stream; native binary is compute executor while KUHUL-ES remains the orchestration target |
| `Start Training` | WebGL2 single-session probe | Uses `kuhul-server` on port 8764 for start/status/events/stop |

Smoke-tested HF tensor path:

```powershell
node .\dist\kuhul-es\bin\kuhul-es.js train-webgl2-sweep `
  --input .\models\from_zero\from_zero_v0.6_merged.safetensors `
  --output .\trainer\build\hf_tensor_smoke.safetensors `
  --token-bin .\tools\test_tokens.bin `
  --tensor-filter "wte\.weight$" `
  --max-tensors 1 --train-dim 16 --steps-per-tensor 1 --batch 1 `
  --lr 0.00001 --seed 1337 --browser auto --timeout-ms 120000 `
  --progress-interval 1
```

That bounded run completed one WebGL2 tensor pass over
`transformer.wte.weight`, wrote a valid `.safetensors` output, and emitted a
`.sweep.xjsl.json` summary.

### Mini GPT — first class (12L / 768d, ~117M)

Fast iteration target. Fits in minimal VRAM, full sweep under a minute on most GPUs:

```powershell
node .\dist\kuhul-es\bin\kuhul-es.js train-webgl2-sweep `
  --input from_zero_v0.6_merged.safetensors `
  --output from_zero_v0.6_adapted.safetensors `
  --token-bin tokens.bin `
  --tensor-filter "\.weight$" --all-tensors `
  --train-dim 768 --steps-per-tensor 64 --batch 16 --lr 0.00025 `
  --browser auto --timeout-ms 300000 --progress-interval 8
```

### Med GPT — first class (24L / 1024d, ~355M)

Standard adaptation target. Use `--train-dim 1024` to match the embedding dimension:

```powershell
node .\dist\kuhul-es\bin\kuhul-es.js train-webgl2-sweep `
  --input coder_skeleton.safetensors `
  --output coder_skeleton.adapted.safetensors `
  --token-bin tokens.bin `
  --tensor-filter "\.weight$" --all-tensors `
  --train-dim 1024 --steps-per-tensor 64 --batch 16 --lr 0.00025 `
  --browser auto --timeout-ms 600000 --progress-interval 16
```

### gpt-oss — if VRAM allows

Large model sweep. Only attempt after mini/med pass cleanly. Reduce
`--steps-per-tensor` and `--batch` if VRAM is tight:

```powershell
node .\dist\kuhul-es\bin\kuhul-es.js train-webgl2-sweep `
  --input gpt-oss.safetensors `
  --output gpt-oss.adapted.safetensors `
  --token-bin tokens.bin `
  --tensor-filter "\.weight$" --all-tensors `
  --train-dim 1024 --steps-per-tensor 32 --batch 8 --lr 0.0001 `
  --browser auto --timeout-ms 1800000 --progress-interval 32
```

### Output format

The `--output` extension selects the target format — same sweep command for all:

| Extension | Target |
|-----------|--------|
| `.safetensors` | HuggingFace-compatible checkpoint (default) |
| `.xshard` | XSHARD tensor partition |
| `.scxqdds` | SCXQDDS quantized shard (DDS wire format) |
| `.dds` | Raw DDS shard |

Example — adapt a mini GPT directly into an XSHARD partition:

```powershell
  --input from_zero_v0.6_merged.safetensors --output from_zero_v0.6.xshard
```

Or into a SCXQDDS shard:

```powershell
  --input from_zero_v0.6_merged.safetensors --output from_zero_v0.6.scxqdds
```

### Smoke test — single tensor slice

**Environment verification only — not a real adaptation pass.** Trains one
bounded slice of one named tensor and exits. Run this first to confirm your
browser/WebGL2/server chain is wired correctly:

```powershell
node .\dist\kuhul-es\bin\kuhul-es.js train-webgl2 `
  --input from_zero_v0.6_merged.safetensors `
  --output smoke.slice.safetensors `
  --tensor transformer.h.0.attn.c_attn.weight --train-dim 512 `
  --batch 16 --steps 24 --lr 0.0006 `
  --browser auto --progress --progress-interval 1
```

Leave `--tensor` empty to auto-select the first F32 tensor found.

### Basher forwarding command

```powershell
node .\dist\kuhul-es\bin\basher.js trainer.webgl2 --input <in.safetensors> --output <out> --token-bin <tokens.bin>
```

### Server orchestration + SSE

Start:

```powershell
node .\dist\kuhul-es\bin\kuhul-server.js
```

Endpoints:

- `POST /v1/train/webgl2/start`
- `GET /v1/train/webgl2/status/:id`
- `GET /v1/train/webgl2/events/:id`
- `GET /v1/train/webgl2/stream/:id` (SSE)
- `POST /v1/train/webgl2/stop/:id`

## Language

```js
// main.kuhules
pi config = { name: "app", version: "1.0.0" };   // immutable binding
 tau frame = 0;                                    // temporal binding + history
function* main() {
  yield* Pop("init");                              // perceive
  yield* Wo("represent", config);                  // represent / build
  yield* Yax(gravity > 0, "plan");                 // plan
  yield* Noj("goal: complete task", { observe: true }); // controlled reasoning
  yield* Sek('log', config.name);                  // execute / compute
  yield* Ch'en("project", result);                 // project / output
  yield* Xul();                                    // consolidate
}
main();
```

| Glyph | Phase | Physics hook |
|-------|-------|--------------|
| `Pop` | perceive | affinity up, entropy decays |
| `Wo` | represent | pressure builds |
| `Yax` | plan | attention focuses |
| `Sek` | execute | attention spikes, pressure drains |
| `Ch'en` | project | entropy rises |
| `Xul` | consolidate | gravity scales up (antigravity → 1.0) |
| `Noj` | reflect / reason | attention consolidates, pressure decays |

## Thinking engine (controlled reasoning)

K'UHUL-ES includes a bounded, deterministic **thinking engine** that performs
pattern-directed inference on the runtime's own state, goals, and observations.
It is inspired by classical rule-driven systems (ELIZA-like transformation) but
is **not conversational or therapeutic**: it reasons about *semantic execution*.

```js
function* main() {
  yield* Pop('observe');
  yield* Noj('goal: finish training', { observe: true });
  yield* Sek('log', 'thoughts generated');
  yield* Xul();
}
```

| Glyph | Role |
|-------|------|
| `Noj` | controlled reasoning phase (reflection) |
| `Sek('think', query)` | alias into the thinking engine |

Each thought is a KAST-like node with `fold`, `opcode: 'INFERE'`, `symbol`, and a
SHA-256 hash, so the reasoning trace is auditable and replayable. Bounds:

- `maxDepth`   — how many inference layers deep (default 4)
- `maxBreadth` — how many thoughts total (default 16)
- `maxRules`   — rule-set size limit (default 64)

### Pattern rules with backreferences

The engine can load PCRE2-style regex rules when `@ofjansen/pcre2-wasm` is
installed; in the browser it falls back to native `RegExp` (which still supports
backreferences). This lets you reason about KAST propositions such as
`fold:Sek node:n12 op:DISPATCH symbol:log`:

```js
const { KuhulThinkEngine } = require('kuhul-es');
const engine = new KuhulThinkEngine({ maxDepth: 3 });

await engine.learnPatternRule(
  'fold-loop',
  '^(fold:\\w+).*\\1',   // backreference detects repeated folds
  '',
  ([fold]) => ({
    proposition: `warn: ${fold} repeats in trace`,
    fold: 'Yax',
    confidence: 0.7,
  })
);

const session = await engine.think('fold:Sek ... fold:Sek');
```

Access programmatically:

```js
const { KuhulThinkEngine } = require('kuhul-es');
const engine = new KuhulThinkEngine({ maxDepth: 3 });
engine.learnBelief('metric:entropy=0.42', 'Pop', 0.95, 'physics');
const session = await engine.think('goal: finish training');
console.log(session.thoughts, session.hash);
```

## Semantic training advisor

The GLSL trainer skeleton is a KAST graph: every tensor node has `fold`,
`opcode`, `gravity`, and `symbol`. `SemanticTrainer` reasons over that graph
plus live physics metrics and returns advice for the optimizer (lower LR for
heavy-gravity nodes, consolidate when entropy is high, raise pressure when the
gravity gate is low, etc.).

```js
const { SemanticTrainer, GLSLTrainer } = require('kuhul-es');
const trainer = new GLSLTrainer({ inputDim: 2, hiddenDim: 40, outputDim: 1 });
const advisor = new SemanticTrainer();

const { advice } = await advisor.analyze(trainer.nodes, trainer.phys.state());
// advice = [ { target: 'lr', node: 'LAYERNORM', action: 'scale', value: 0.85 }, ... ]
```

To enable live advice during training:

```bash
kuhul-es train config.json --semantic --semantic-interval 5
```

## AST-based runtime expression evaluation

The runtime no longer relies on fragile regex parsing for π/τ bindings and glyph
arguments. It uses the TypeScript AST + a safe `ExpressionEvaluator` that
supports literals, arithmetic, comparisons, ternaries, member access, `Math.*`
calls, and string concatenation.

```js
π task = "finish training";
function* main() {
  yield* Noj('goal: ' + task, { observe: true }); // evaluates to 'goal: finish training'
  yield* Sek('log', Math.max(0, 7 - 3));
  yield* Xul();
}
main();
```

Programmatic access:

```js
const { ExpressionEvaluator, RuntimeParser } = require('kuhul-es');
const ev = new ExpressionEvaluator({ π: new Map([['x', 10]]) });
console.log(ev.eval('x + 5')); // 15
```

## Fold engine — lazy semantic depth

KUHUL-ES folds are **vertical semantic containers**; nodes inside a fold are an
**ordered linear array**. A fold stays collapsed until an unfold rule admits it,
so execution surface grows by *progressive disclosure* without mutating already
admitted nodes.

```text
FOLD AXIS = vertical / semantic depth
NODE AXIS = horizontal / linear execution
```

The canonical schema is `kfold/1` (see `schemas/kfold-1.json`). Folds carry:

- `id`, `phase` (Pop/Wo/Yax/Sek/Ch'en/Xul), `state`
- `parent` pointer and `depth`
- `nodes[]` — linear lane/index/glyph/opcode entries
- `unfolds[]` — child folds gated by `always | capability | pressure | confidence | dependency | explicit`

Programmatic use:

```js
const { FoldEngine } = require('kuhul-es');
const fe = new FoldEngine({ maxDepth: 32 });

fe.registerFold({
  id: 'gravity', phase: 'Sek', axis: 'vertical', state: 'collapsed',
  parent: null, depth: 0,
  nodes: [
    { id: 'g0', index: 0, axis: 'linear', lane: 'math', glyph: '÷', opcode: 'DIV', symbol: 'inverse_square', operands: ['G*m1*m2', 'r*r'] },
    { id: 'g1', index: 1, axis: 'linear', lane: 'math', glyph: '×', opcode: 'MUL', symbol: 'force', operands: ['inverse_square', 'direction'] },
  ],
  unfolds: [{ target: 'orbital', gate: 'dependency', condition: 'orbit_required', ordinal: 0 }],
});

fe.on('fold:expanded', (ev) => console.log('unfolded', ev.foldId, ev.nodesRevealed));
fe.admit('gravity');
fe.exec('gravity', (nodes) => nodes.forEach(n => console.log(n.opcode)));
console.log(fe.toJSON()); // kfold/1 graph
console.log(fe.toKast());  // kast/1 graph with FOLD + linear nodes + next/unfold edges
```

The reference implementation is TypeScript: `runtime/src/fold-engine.ts`,
compiled to both CommonJS (`runtime/src/fold-engine.js`) and ESM
(`runtime/src/fold-engine.mjs`) by `npm run build:fold`.

## Token / embedding language-model training

The GLSL trainer supports token-mode training with an embedding lookup layer,
layer norm, GELU FFN, LM head, and stable softmax cross-entropy loss. Pass a
text corpus and either an HF tokenizer or the built-in char-level fallback:

```json
{
  "dataset": "text",
  "textFile": "corpus.txt",
  "tokenizer": "tokenizer.json",
  "seqLen": 4,
  "embedDim": 64,
  "hiddenDim": 128,
  "lr": 0.15,
  "steps": 200
}
```

```bash
kuhul-es train text_lm.json --out model.kson
```

For chat corpora (e.g. UltraChat JSONL), use `dataset: "jsonl_chat"`:

```json
{
  "dataset": "jsonl_chat",
  "chatFile": "E:\\data\\ultrachat_jsonl\\ultrachat_basic_chat.jsonl",
  "tokenizer": "tokenizer.json",
  "seqLen": 8,
  "maxRecords": 50000,
  "maxSamples": 250000,
  "embedDim": 64,
  "hiddenDim": 128,
  "lr": 0.12,
  "steps": 200
}
```

The exported KAST manifest references external weight artifacts
(`model-weights/*.bin`) instead of inlining raw tensors, and includes tokenizer
metadata.

Programmatic access:

```js
const { GLSLTrainer, loadTokenizer, buildTokenDataset, buildChatJsonlTokenDataset } = require('kuhul-es');
const tok = await loadTokenizer({ path: 'tokenizer.json' });
const { dataset, vocabSize } = await buildTokenDataset({ file: 'corpus.txt', tokenizer: tok, seqLen: 4 });
const chat = await buildChatJsonlTokenDataset({ file: 'ultrachat.jsonl', tokenizer: tok, seqLen: 8 });
const trainer = new GLSLTrainer({ vocabSize, embedDim: 64, hiddenDim: 128, lr: 0.15, steps: 200 });
await trainer.train(chat.dataset);
const generated = trainer.generate(chat.dataset[0].x, 20); // greedy token ids
```

### Base-chat merge path (SLERP + STB bridge)

Recommended flow for preserving chat behavior while layering new capabilities:

1. Keep a base chat checkpoint (safetensors) as the anchor.
2. Train/finetune specialty variants in safetensors.
3. Merge variants back toward the base with `tools/merge_models.py --method slerp`.
4. Convert the merged safetensors into KHANARY runtime tensors with `tools/safetensors_to_stb.py`.

This keeps training in known HuggingFace-compatible formats, then converts to `.stb` only at packaging/runtime boundaries.

## Isomorphic core runtime

The runtime is now split into an isomorphic core (`runtime/src/core.js`) plus
platform adapters:

- `runtime/src/node.js` — Node.js adapter (fs, process.stdout)
- `runtime/src/browser.js` — browser adapter (DOM/CSS-VER)
- `sw.js` — service worker that imports the core and can execute KUHUL-ES code
  offline

This means the same execution engine, parser, physics, and thinking engine run
in Node, the browser main thread, and the service worker.

## PWA / Service Worker

`kuhul-es` ships as an installable PWA:

- `index.html` — runtime playground with source editor and trace viewer
- `manifest.webmanifest` — installability metadata
- `sw.js` — module service worker that precaches runtime assets and can execute
  KUHUL-ES code via the `KUHUL_EXECUTE` message channel even when offline

```js
// From a web page
const reg = await navigator.serviceWorker.register('./sw.js', { type: 'module' });
const controller = navigator.serviceWorker.controller;
controller.postMessage({
  type: 'KUHUL_EXECUTE',
  id: 1,
  payload: { source: `yield* Sek('log', 'offline execution');` },
});
```

When the service worker is not registered, `index.html` falls back to running the
engine directly via `runtime/src/browser.js`.

## Browser manifest

`browser.manifest.json` declares browser/Node/worker/service-worker entry points,
optional WASM dependencies, KXML capabilities, and the file whitelist for bundlers.
It is the source of truth for which files are safe to ship to a browser build.

### Optional: PCRE2 (WASM) for richer pattern reasoning

The thinking engine's pattern reasoner supports PCRE2-style regex when a
PCRE2 WASM build is provided. The service worker attempts to load a PCRE2
loader during install and will advertise its availability to pages.

To enable full PCRE2 in the browser:

1. Install the PCRE2 WASM package locally:

   npm install @ofjansen/pcre2-wasm --save

2. Copy the distribution files into the package's `pcre2/` folder (there is
   a helper script included):

   npm run build:pcre2

   This runs `scripts/copy-pcre2.js`, which locates the `@ofjansen/pcre2-wasm`
   `dist/` directory and copies its files into `./pcre2/` inside this package.

3. Serve the site (SW requires HTTPS or localhost) and open `index.html`.
   The service worker will try to import `./pcre2/pcre2.js` and initialize the
   WASM. The page shows PCRE2 status in the runtime header.

If the WASM loader is not present or fails to initialize, the reasoner falls
back to native JavaScript `RegExp` with a safety timeout. The local helper
script will overwrite the shipped shim (`pcre2/pcre2.js`) with the real
loader when available.

## KXML model runtime

KXML is the declarative compute-graph + chat-template layer from the parent
KHΛNARY project. `kuhul-es` bundles a JavaScript KXML inference driver that
loads `.stb` weights + a model manifest, walks the `forward_graph`, executes
K'UHUL glyphs (G_EMBED, G_LAYERNORM, G_MATMUL, G_ATTENTION, G_GELU) with pure
JS kernels, and emits a semantic KAST trace of folds/nodes.

```bash
kuhul-es kxml --stb model.stb --manifest model.stb.json --run --kast-out trace.json
kuhul-es kxml --stb model.stb --manifest model.stb.json --generate 8
kuhul-es kxml --stb model.stb --manifest model.stb.json --chat --prompt "hello"
```

Programmatic access:

```js
const { KxmlModel, readStbFile } = require('kuhul-es');
const manifest = JSON.parse(fs.readFileSync('model.stb.json', 'utf8'));
const weights = await readStbFile('model.stb');
const model = new KxmlModel(manifest, weights);
const logits = model.forward([bosToken]);
const kast = model.toKast(); // semantic fold/node trace
```

Chat templates:

```js
const { toJinja, renderForGguf } = require('kuhul-es');
const prompt = renderForGguf(messages, toJinja(), { addGenerationPrompt: true });
```

### Fold role chat templates

Fold tokens (`<POP>/<WO>/<YAX>/<SEK>/<CHEN>/<XUL>`) are ROLE tokens — turn boundaries that set the model's cognitive mode. `<XUL>` is always the model response token (analogous to `ASSISTANT`).

| Token | ID | Mode |
|-------|----|------|
| `<POP>` / `</POP>` | 50282 / 50283 | observe — describe / explain / read context |
| `<WO>` / `</WO>` | 50284 / 50285 | schedule — plan / organize / outline steps |
| `<YAX>` / `</YAX>` | 50286 / 50287 | branch — explore / generate alternatives |
| `<SEK>` / `</SEK>` | 50288 / 50289 | execute — code / implement / produce KSON |
| `<CHEN>` / `</CHEN>` | 50290 / 50291 | verify — validate / debug / check constraints |
| `<XUL>` / `</XUL>` | 50292 / 50293 | emit — model response (always) |

```js
const { renderFoldTurn, renderFoldPrompt, foldForRole, FOLD_ROLES } = require('kuhul-es');

// Render a fold-role turn (input side)
renderFoldTurn('Sek', 'write a KSON node for matmul');
// → '<SEK>write a KSON node for matmul</SEK>'

// Render prompt with <XUL> appended — model continues after it
renderFoldPrompt('Sek', 'write a KSON node for matmul');
// → '<SEK>write a KSON node for matmul</SEK><XUL>'

// Resolve a message role string to its fold descriptor
foldForRole('chen'); // → { open: '<CHEN>', close: '</CHEN>', id_open: 50290, id_close: 50291 }
```

Pass fold messages through `toJinja()` / `renderForGguf()` using the fold phase name as the `role`:

```js
const { toJinja, renderForGguf } = require('kuhul-es');

const messages = [
  { role: 'Sek', content: 'write a matmul KSON node' },
  { role: 'Xul', content: '{ "kind": "compute", "opcode": "MATMUL", ... }' },
];
const prompt = renderForGguf(messages, toJinja(), { addGenerationPrompt: false });
// → '<SEK>write a matmul KSON node</SEK><XUL>{ "kind": ... }</XUL><SEP>'
```

The fold role adapter is registered in `models/from_zero/atomic.manifest.json` under `model.adapters.fold_chat` with token IDs 50282–50293 and applies to `.kuhul`, `.khl`, and `.kuhules` files.

KXML assets are bundled under `kxml/` (nodes.json, alignment.json, chat_template.json/.jinja).

## Browser manifest

`browser.manifest.json` declares browser/Node entry points, optional WASM
dependencies, KXML capabilities, and the file set for bundlers. It is the
source of truth for which files are safe to ship to a browser build.

## Runtime physics (semantic execution metrics)

The equations below are **semantic execution metrics**, not a Newtonian simulation.
They form the runtime state model that influences execution: gravity gates the
learning rate, entropy/attention/pressure route attention, affinity tracks fold
replay. They are scheduling/execution heuristics in the K'UHUL sense — "not
rendering. Computing."

`runtime/src/physics.js` (matches FieldExecutionEngine):

```
gravity_gate = clamp(1.0 + 0.35·pressure - 0.25·entropy + 0.15·attention + 0.10·affinity, 0.1, 4.0)
gravity      = 9.80665 · gravity_gate
arc_bias[i]  = 1.0 + 0.10·attention - 0.08·entropy + 0.06·pressure + 0.04·affinity
arc_weight[i]= clamp((1/√1024) · arc_bias[i], 0.01, 2.0)
velocity[i]  = 0.001 · (attention - entropy) · (1 + i%7)
```

Every glyph tick updates the physics state; the deterministic hash chain includes the
physics snapshot. Access via `runtime.physics.state()` / `runtime.physics.history`.

## WebView2 smoke test

A Windows WebView2 harness lives in `tools/webview2-smoke-test/`. It serves the
package root over HTTP, opens `index.html` in WebView2, and waits for the
service worker to broadcast `PCRE2_STATUS`.

```powershell
# From the actual project root:
cd dist/v3.5.0-WebX/micronauts/micronaut_0.1.1/kuhul-es-1.0.18

# Add the WebView2 package once:
dotnet add tools/webview2-smoke-test package Microsoft.Web.WebView2

# Run: first arg = root to serve, second arg = port
dotnet run --project tools/webview2-smoke-test -- . 8080
```

Launch from the `kuhul-es-1.0.18` project root.

## CLI

```bash
kuhul-es run <file>           # execute .kuhules via pi/tau/glyph runtime + physics
kuhul-es run <file> --record --physics-out phys.json --thoughts-out thoughts.json
kuhul-es compile <file>       # .kuhules -> canonical KAST (.kson, protocol kast/1)
kuhul-es compile <f> --driver # emit with a @driver contract (provider binding)
kuhul-es compile <f> --driver-only # driver-only KAST: capabilities + phase hooks, application body stripped
kuhul-es train <config.json>         # GLSL trainer: semantic skeleton + physics
kuhul-es train <config.json> --semantic # enable semantic advisor (reasons over folds/nodes/metrics)
kuhul-es train <text.json> --out model.kson # token-mode embedding LM
kuhul-es train <chat.json> --out model.kson # chat JSONL token-mode embedding LM
kuhul-es train-native --model gpt2-medium --data tokens.bin --out model.safetensors
kuhul-es train-native --dry-run      # print resolved trainer cmd + KUHUL physics gate/env
kuhul-es train-webgl2 --input model.safetensors --output model.webgl2.safetensors --token-bin tokens.bin
kuhul-es train-webgl2 --input model.safetensors --output model.webgl2.safetensors --json # raw NDJSON progress stream
kuhul-es gpu                  # probe GLSL compute backends and write kernel sources
kuhul-es kxml --stb <w.stb> --manifest <m.json> --run  # run a KHANARY KXML model
kuhul-es kxml --template-out ./templates                    # emit KXML chat templates
kuhul-es new <name>           # scaffold a K'UHUL project
kuhul-es doctor               # environment diagnostics
```

### WebGL2 trainer progress lanes (terminal + WebView2/TypeScript)

- `kuhul-es train-webgl2` emits live progress and final result from `dist/kuhul-runtime-v1/trainer/webgl2_hf_safetensor_trainer.cjs`.
- `basher trainer.webgl2 ...` forwards to the same command surface for operator-shell usage.
- `node bin/kuhul-server.js` exposes HTTP + SSE orchestration:
  - `POST /v1/train/webgl2/start`
  - `GET /v1/train/webgl2/status/:id`
  - `GET /v1/train/webgl2/events/:id`
  - `GET /v1/train/webgl2/stream/:id`
  - `POST /v1/train/webgl2/stop/:id`

## Compilation pipeline (canonical IR)

`.kuhules` is a front end into the same IR as `.kuhul`/`.khl`:

```text
.kuhules
   ↓ KUHULParser (TypeScript AST + pi/tau/glyph extraction)
KAST (protocol kast/1 — nodes carry fold/lane/glyph/opcode)
   ↓ JSON serialization
KSON (.kson)
   ↓ admission (tools/kson_validate.py)
canonical phase engine
```

Semantic rules:
- **phase glyph ≠ opcode** — `yield* Sek('log', …)` lowers to `fold=Sek, glyph=Sek, opcode=DISPATCH, symbol=log`. The phase says *where*; the opcode says *what*.
- **application KAST ≠ driver KAST** — plain programs emit no `@driver`; only provider bindings (`--driver`) carry the contract (abi/requires/capabilities/phase_hooks/provider/resources/hash).
- **driver-only KAST (secure admission surface)** — `compiler/src/driver-kast.js`:
  `toDriverOnly(fullKast)` builds the full application KAST, then strips ALL
  application nodes/edges, emitting `kind: 'driver-only'` with the hashed
  `@driver` contract + `@admission` rules (`allowed_glyphs/opcodes/folds`
  derived from actual usage — least privilege; `max_nodes/max_edges`;
  `resource_limits` for memory/workgroup/dispatch). `verifyDriverOnly()` checks
  ABI, provider whitelist, capabilities, resource limits, and the contract hash
  (tamper detection). The Python admission gate (`tools/kson_validate.py`
  `verify_driver_only`) is the cross-language port. Usage:
  ```js
  const driverKast = toDriverOnly(fullKast, {
    provider: 'kuhul-glsl',
    resourceLimits: { maxNodes: 100, maxMemoryMb: 512, maxWorkgroupSize: 256 }
  });
  const { admitted, reason } = verifyDriverOnly(driverKast, runtimeCaps);
  ```
  `--driver-only` strips ALL application layers (pi/tau value binds, glyph calls, generators, directives) and emits only the admitted capability nodes + `@driver` contract. For untrusted model execution: the sandbox mounts the capabilities and executes ONLY through the declared phase hooks — the program body never ships. Declare the surface with pi bindings:
  ```kuhules
  pi provider = 'glsl_gpu';
  pi capabilities = ['shader.compile', 'shader.compute', 'tensor.matmul', 'buffer.alloc'];
  ```
  The `.khl` driver contracts (opengl.khl, phase.khl, …) are the khlc/Python-side equivalent of this form (`drivers/khl/`, not shipped in the npm package).

Example lowering of `examples/hello.kuhules`:

```text
pi config = {...}      -> fold=Pop  opcode=BIND    symbol=config
tau frame = 0;         -> fold=Wo   opcode=BIND    symbol=frame
yield* Pop("init")     -> fold=Pop  opcode=PROBE   symbol=init
yield* Sek('log',...)  -> fold=Sek  opcode=DISPATCH symbol=log
function* main()       -> fold=Sek  opcode=GLYPH   symbol=main
```

## Programmatic

```js
const { KUHULRuntimeNode } = require('kuhul-es/runtime/src/node.js');
const rt = new KUHULRuntimeNode();
await rt.execute(source);
console.log(rt.physics.history);   // physics trace
console.log(rt.hashChain);         // deterministic execution trace
```

## GPU / compute backend transports

`GLSLTrainer` supports pluggable backend transports. Two optional transports are
provided for talking to local or remote native compute servers. The native
binaries are **not** shipped unpacked inside the npm tarball; they are bundled
in `bin/bin.zip` to keep install sizes small. Extract them before using the
local GPU backends:

```bash
npm run extract-bin   # unpacks bin/bin.zip into bin/
```

After extraction the package contains:

- `bin/GLSL_Server.exe` + `bin/server.glsl.json` + `bin/neural_layer.glsl` (Powernaut GLSL server)
- `bin/xvm-d3d12/*.exe` and `xvm_d12.dll` (XVM D3D12 stack)

```js
const {
  GLSLTrainer,
  glslHttpTransport,
  powernautGlslTransport,
  hybridClusterGlslTransport,
  xvmD3d12Transport,
} = require('kuhul-es');

// Generic GLSL sidecar (json_runtime glsl_gpu endpoint)
const sidecar = glslHttpTransport('http://127.0.0.1:8787');

// Powernaut GLSL Object Server
const glslServer = powernautGlslTransport('http://127.0.0.1:9060', {
  manifest: path.join(__dirname, 'bin', 'server.glsl.json'),
});

// XVM D3D12 native stack
const xvm = xvmD3d12Transport({ xvmDir: path.join(__dirname, 'bin', 'xvm-d3d12') });

// Hybrid split: cluster linalg + GLSL physics/mapping
const hybrid = hybridClusterGlslTransport({
  xvmDir: path.join(__dirname, 'bin', 'xvm-d3d12'),
  glslEndpoint: 'http://127.0.0.1:9060',
  manifest: path.join(__dirname, 'bin', 'server.glsl.json'),
});

const trainer = new GLSLTrainer({ vocabSize, embedDim, hiddenDim, nHead, transport: sidecar });
```

CLI:

```bash
# 1. extract native binaries
npm run extract-bin

# 2. use the local bundled server
kuhul-es gpu --backend powernaut-glsl --backend-endpoint http://127.0.0.1:9060
kuhul-es train config.json --backend powernaut-glsl
kuhul-es train config.json --backend xvm-d3d12
kuhul-es train config.json --backend hybrid-cluster-glsl --backend-endpoint ./bin/xvm-d3d12 --glsl-endpoint http://127.0.0.1:9060
```

The `powernautGlslTransport` maps KUHUL-ES kernels (`matmul`, `gelu`, `layernorm`,
`softmax`, `adam`) to the Powernaut server's opcodes (`WO_DENSE`, `WO_GEGLU`,
`WO_RMS_NORM`, `WO_SOFTMAX`, `WO_ADAM_STEP`) and builds the `/dispatch` / `/chain`
JSON envelope that the server expects. The default `--backend-manifest` points
to the bundled `bin/server.glsl.json`. If `GLSL_Server.exe` is unavailable,
supply a custom manifest and endpoint instead.

The `xvmD3d12Transport` is a shell-out stub; full native dispatch requires a
compiled `.scx2` tape and the XVM runtime binaries.

The `hybridClusterGlslTransport` routes linalg-heavy ops (matmul/embed/ffn/lm_head)
to the XVM thread cluster path and routes physics/mapping ops (layernorm/gelu/softmax/adam)
to the Powernaut GLSL sidecar, with cluster fallback when the GLSL server is unavailable.

## Micronaut bridges

`kuhul-es` now exposes a Micronaut bridge layer that wraps the existing runtime
backend transports and also supports filesystem/http/queue bridge patterns.

```js
const path = require('path');
const {
  BridgeFactory,
  SkeletonFactory,
} = require('kuhul-es');

const bridge = BridgeFactory.create('powernaut-glsl', {
  endpoint: 'http://127.0.0.1:9060',
  manifest: path.join(__dirname, 'bin', 'server.glsl.json'),
});

await bridge.connect('gpu');
const health = await bridge.send('gpu', { operation: 'health' });

const skel = SkeletonFactory.create('transformer', {
  numLayers: 2,
  hiddenDim: 256,
  materializeWeights: false, // keep large tensors as deferred references
});
console.log(health.ok, skel.semantic_hash);
```

Available bridge families:

- Runtime backends: `powernaut-glsl`, `xvm-d3d12`, `hybrid-cluster-glsl`
- System bridges: `filesystem`, `http`
- Domain bridges: `message-queue`

## Attention-based token training

`GLSLTrainer` now supports a tiny causal self-attention LM in token mode:

```js
const { GLSLTrainer, loadTokenizer, buildTokenDataset } = require('kuhul-es');
const { dataset, vocabSize } = await buildTokenDataset({ file: corpus, tokenizer, seqLen: 4 });
const trainer = new GLSLTrainer({ vocabSize, embedDim: 16, hiddenDim: 32, nHead: 4, lr: 0.15, steps: 12 });
await trainer.train(dataset);
const ids = trainer.generate(dataset[0].x, 5);
```

The trainer inserts `ATTN_QKV` / `ATTN_PROJ` skeleton nodes, runs causal multi-head self-attention forward/backward, and emits a KAST manifest that references external weight artifacts.

## KXML → kfold/1 mapping

`KxmlModel.toKast()` now emits a `kfold/1` graph: each forward-graph step becomes a vertical fold, linked by `unfolds`, with linear nodes carrying operands and glyph metadata.

```js
const { KxmlModel } = require('kuhul-es');
const model = new KxmlModel(manifest, weights);
model.forward(tokens);
const kfold = model.toKast(); // { protocol: 'kfold/1', entry_fold, folds }
```

## Browser / API chat bridge

`ChatBridge` (Node and browser/ESM) routes OpenAI-style `chat.completions` calls through the local semantic engine and renders responses with KXML/Jinja templates. Tool-aware turns are supported and can be intercepted offline by the service worker.

```js
const { ChatBridge } = require('kuhul-es');
const bridge = new ChatBridge({ tools: [weatherTool] });
const response = await bridge.complete({
  model: 'kuhul-es',
  messages: [{ role: 'user', content: 'get_weather London' }],
});
// response.choices[0].message.tool_calls[0].function.name === 'get_weather'
```

The service worker in `sw.js` intercepts `POST /v1/chat/completions` so the PWA can answer chat requests locally.

## KUHUL-E domain-specific response engine

`KUHULEngine` treats responses as fold expansions over domain stacks (tech, medical, legal, creative, etc.). It matches patterns, runs attention-weighted research hooks, expands response folds through the `FoldEngine`, and learns from feedback.

```js
const { KUHULEngine } = require('kuhul-es');
const engine = new KUHULEngine();
engine.registerResearch('wikipedia', async (q) => ({ source: 'wikipedia', content: `Article: ${q}`, confidence: 0.7 }));
const result = await engine.query('My computer is running slow', { domain: 'tech' });
console.log(result.response, result.metadata.confidence);
const knowledge = engine.exportKnowledge(); // KAST-compatible domain/pattern/fold graph
```

## License

Proprietary — © canna.seed.us (xjson). Contact the maintainer for usage.
