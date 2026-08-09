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

## Install

```bash
npm install kuhul-es
```

Dependencies: `commander` (MIT, the standard Node CLI parser — zero deps, open source).

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

## CLI

```bash
kuhul-es run <file>           # execute .kuhules via pi/tau/glyph runtime + physics
kuhul-es run <file> --record --physics-out phys.json --thoughts-out thoughts.json
kuhul-es compile <file>       # .kuhules -> canonical KAST (.kson, protocol kast/1)
kuhul-es compile <f> --driver # emit with a @driver contract (provider binding)
kuhul-es compile <f> --driver-only # driver-only KAST: capabilities + phase hooks, application body stripped
kuhul-es train <config.json>         # GLSL trainer: semantic skeleton + physics
kuhul-es train <config.json> --semantic # enable semantic advisor (reasons over folds/nodes/metrics)
kuhul-es gpu                  # probe GLSL compute backends and write kernel sources
kuhul-es kxml --stb <w.stb> --manifest <m.json> --run  # run a KHANARY KXML model
kuhul-es kxml --template-out ./templates                    # emit KXML chat templates
kuhul-es new <name>           # scaffold a K'UHUL project
kuhul-es doctor               # environment diagnostics
```

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

## License

Proprietary — © canna.seed.us (xjson). Contact the maintainer for usage.
