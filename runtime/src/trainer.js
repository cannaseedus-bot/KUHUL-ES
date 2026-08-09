// kuhul-es/runtime/src/trainer.js
//
// GLSL Trainer — semantic skeleton training for the K'UHUL runtime.
//
// The network is built AS a K'UHUL skeleton: nodes picked from the
// XCFE/KXML mapping, each weight tensor carries a semantic identity
// (fold / lane / glyph / opcode / gravity), and forward/backward route
// through the folds. Folds are the bone structure; training fills the
// weights. Physics (KuhulPhysics) drives the FIELD_OPTIMIZER node.
//
// Node pick (from kxml_nodes.json + XCFE tensor opcodes):
//   EMBED_NODE            Pop  embed    opcode EMBED    gravity Embed
//   LAYERNORM_NODE        Wo   layernorm opcode LNORM   gravity Heavy
//   FFN_NODE              Sek  gelu     opcode FFN      gravity Normal
//   LM_HEAD_NODE          Xul  lm_head  opcode LMHEAD   gravity Heavy
//   LOSS_NODE             Ch'en mse     opcode LOSS     gravity Heavy
//   FIELD_OPTIMIZER_NODE  Ch'en physics opcode OPTIM    gravity Normal
//
// GLSL kernels map by glyph: EMBED/FFN/LM_HEAD -> MATMUL, LAYERNORM ->
// LAYERNORM, FFN gelu -> GELU. model() exports the trained skeleton as a
// KAST-like document (nodes/edges/weights/physics) -> serializable .kson.

const { KuhulPhysics } = require('./physics');
const { MATMUL, GELU, LAYERNORM } = require('./glsl_kernels');
const { SemanticTrainer } = require('./trainer_semantic');
const http = require('http');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tanh = (v) => Math.tanh(v);

// ── semantic node pick (XCFE/KXML mapped) ───────────────────────────────────
const NODE_SPECS = [
  { id: 'EMBED',            fold: 'Pop',   lane: 'input',   glyph: 'embed',     opcode: 'EMBED',  gravity: 'Embed'  },
  { id: 'LAYERNORM',        fold: 'Wo',    lane: 'normalize', glyph: 'layernorm', opcode: 'LNORM', gravity: 'Heavy' },
  { id: 'FFN',              fold: 'Sek',   lane: 'compute', glyph: 'gelu',      opcode: 'FFN',    gravity: 'Normal' },
  { id: 'LM_HEAD',          fold: 'Xul',   lane: 'output',  glyph: 'lm_head',   opcode: 'LMHEAD', gravity: 'Heavy' },
  { id: 'LOSS',             fold: 'Ch\'en', lane: 'verify', glyph: 'mse',       opcode: 'LOSS',   gravity: 'Heavy' },
  { id: 'FIELD_OPTIMIZER',  fold: 'Ch\'en', lane: 'update', glyph: 'physics',   opcode: 'OPTIM',  gravity: 'Normal' },
];

// node index for routing (matches NODE_SPECS order)
const N = { EMBED: 0, LAYERNORM: 1, FFN: 2, LM_HEAD: 3, LOSS: 4, OPTIM: 5 };
const PHASE_CYCLE = ['Pop', 'Wo', 'Yax', 'Sek', 'Ch\'en', 'Xul'];

// gravity class -> physics multiplier for the optimizer
const GRAVITY_BOOST = { Embed: 0.8, Normal: 1.0, Heavy: 1.2 };

// ── default GLSL transport: json_runtime glsl_gpu sidecar ────────────────
function glslHttpTransport(endpoint = 'http://127.0.0.1:8787') {
  return (op, payload) => {
    const url = new URL(endpoint);
    return new Promise((resolve) => {
      const req = http.request({
        host: url.hostname, port: url.port,
        path: '/api/run', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 3000,
      }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ ok: true, result: JSON.parse(data) }); }
          catch { resolve({ ok: true, result: data }); }
        });
      });
      req.on('error', () => resolve({ ok: false, error: 'glsl transport unreachable' }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.write(JSON.stringify(payload));
      req.end();
    });
  };
}

class GLSLTrainer {
  constructor(opts = {}) {
    this.inputDim  = opts.inputDim  ?? 1;
    this.hiddenDim = opts.hiddenDim ?? 32;
    this.outputDim = opts.outputDim ?? 1;
    this.lr        = opts.lr        ?? 0.05;
    this.steps     = opts.steps     ?? 300;
    this.momentum  = opts.momentum  ?? 0.9;
    this.phys      = new KuhulPhysics();
    this.transport = opts.transport ?? null;
    this.verbose   = opts.verbose ?? true;
    this.losses    = [];
    this.gpuActive = false;
    this.step      = 0;
    this.kernels   = { MATMUL, GELU, LAYERNORM };
    this.semantic  = opts.semanticTrainer || null; // optional SemanticTrainer
    this._semanticAdvice = [];                     // advice log per epoch

    this._buildSkeleton();
  }

  // ── skeleton: tensors as semantic nodes ───────────────────────────────────
  _buildSkeleton() {
    const rnd = (n, s = 0.3) => Array.from({ length: n }, () => (Math.random() * 2 - 1) * s);
    const H = this.hiddenDim;

    // node tensors (each weight/bias carries a node identity)
    this.nodes = [
      { ...NODE_SPECS[N.EMBED],       weight: rnd(H * this.inputDim),        bias: null,
        shape: [H, this.inputDim], symbol: 'W_embed' },
      { ...NODE_SPECS[N.LAYERNORM],   weight: new Array(H).fill(1),           bias: new Array(H).fill(0),
        shape: [H], symbol: 'ln_gamma/beta' },
      { ...NODE_SPECS[N.FFN],         weight: rnd(H * H),                     bias: new Array(H).fill(0),
        shape: [H, H], symbol: 'W_ffn' },
      { ...NODE_SPECS[N.LM_HEAD],     weight: rnd(this.outputDim * H),        bias: new Array(this.outputDim).fill(0),
        shape: [this.outputDim, H], symbol: 'W_lm_head' },
      { ...NODE_SPECS[N.LOSS],        weight: null, bias: null, shape: [], symbol: 'mse' },
      { ...NODE_SPECS[N.OPTIM], weight: null, bias: null, shape: [], symbol: 'physics' },
    ];

    // control edges: Pop -> Wo -> Sek -> Xul (fold skeleton)
    this.edges = [
      { from: 'EMBED', to: 'LAYERNORM', kind: 'control', label: 'Pop->Wo' },
      { from: 'LAYERNORM', to: 'FFN',   kind: 'control', label: 'Wo->Sek' },
      { from: 'FFN', to: 'LM_HEAD',     kind: 'control', label: 'Sek->Xul' },
      { from: 'LM_HEAD', to: 'LOSS',    kind: 'control', label: 'Xul->Chen' },
      { from: 'LOSS', to: 'FIELD_OPTIMIZER', kind: 'control', label: 'Chen->update' },
    ];

    // momentum velocity buffers (per tensor)
    this.velMap = new Map();
    const keyOf = (w) => w;
    for (const n of this.nodes) {
      if (n.weight) this.velMap.set(keyOf(n.weight), new Array(n.weight.length).fill(0));
      if (n.bias)   this.velMap.set(keyOf(n.bias),   new Array(n.bias.length).fill(0));
    }
    this.keyOf = keyOf;
  }

  node(id) { return this.nodes[N[id]]; }

  // ── forward: semantic routing through folds ───────────────────────────────
  forward(x) {
    const H = this.hiddenDim;
    const embed = this.node('EMBED');
    const ln    = this.node('LAYERNORM');
    const ffn   = this.node('FFN');
    const head  = this.node('LM_HEAD');

    // EMBED (Pop): e = W_embed @ x
    const e = new Array(H);
    for (let j = 0; j < H; j++) {
      let s = 0;
      for (let i = 0; i < this.inputDim; i++) s += embed.weight[j * this.inputDim + i] * x[i];
      e[j] = s;
    }
    // LAYERNORM (Wo): ln over hidden
    let mean = 0, varSum = 0;
    for (let j = 0; j < H; j++) { mean += e[j]; varSum += e[j] * e[j]; }
    mean /= H; varSum = varSum / H - mean * mean;
    const z = new Array(H);
    for (let j = 0; j < H; j++) z[j] = (e[j] - mean) / Math.sqrt(varSum + 1e-5) * ln.weight[j] + ln.bias[j];
    // FFN (Sek): h = gelu(W_ffn @ z + b)
    const h = new Array(H);
    for (let j = 0; j < H; j++) {
      let s = ffn.bias[j];
      for (let k = 0; k < H; k++) s += ffn.weight[j * H + k] * z[k];
      const v = s;
      h[j] = 0.5 * v * (1 + tanh(0.7978845608 * (v + 0.044715 * v * v * v)));
    }
    // LM_HEAD (Xul): y = W_lm @ h + b
    const y = new Array(this.outputDim);
    for (let o = 0; o < this.outputDim; o++) {
      let s = head.bias[o];
      for (let j = 0; j < H; j++) s += head.weight[o * H + j] * h[j];
      y[o] = s;
    }
    return { e, z, h, y, mean, varSum };
  }

  // ── LOSS (Ch'en) — pure gradient computation for one sample ────────────
  _grads(x, target) {
    const H = this.hiddenDim;
    const { e, z, h, y, mean, varSum } = this.forward(x);

    let loss = 0;
    const dy = new Array(this.outputDim);
    for (let o = 0; o < this.outputDim; o++) { const d = y[o] - target[o]; loss += d * d; dy[o] = 2 * d; }
    loss /= this.outputDim;
    for (let o = 0; o < this.outputDim; o++) dy[o] /= this.outputDim;

    const head = this.node('LM_HEAD'), ffn = this.node('FFN'), ln = this.node('LAYERNORM'), embed = this.node('EMBED');

    const dh = new Array(H);
    for (let j = 0; j < H; j++) { dh[j] = 0; for (let o = 0; o < this.outputDim; o++) dh[j] += dy[o] * head.weight[o * H + j]; }

    const gWhead = new Array(this.outputDim * H), gbhead = new Array(this.outputDim).fill(0);
    for (let o = 0; o < this.outputDim; o++) {
      gbhead[o] = dy[o];
      for (let j = 0; j < H; j++) gWhead[o * H + j] = dy[o] * h[j];
    }

    const gWffn = new Array(H * H), gbffn = new Array(H).fill(0);
    const dlnIn = new Array(H);
    for (let j = 0; j < H; j++) {
      let s = ffn.bias[j];
      for (let k = 0; k < H; k++) s += ffn.weight[j * H + k] * z[k];
      const t = tanh(0.7978845608 * (s + 0.044715 * s * s * s));
      const dgelu = 0.5 * (1 + t) + 0.5 * s * (1 - t * t) * (0.7978845608 * (1 + 3 * 0.044715 * s * s));
      const dj = dh[j] * dgelu;
      gbffn[j] = dj;
      for (let k = 0; k < H; k++) gWffn[j * H + k] = dj * z[k];
      dlnIn[j] = 0;
      for (let k = 0; k < H; k++) dlnIn[j] += gbffn[k] * ffn.weight[k * H + j];
    }

    // exact layernorm backprop (mean/var coupling)
    const stdInv = 1 / Math.sqrt(varSum + 1e-5);
    const u = new Array(H), a = new Array(H);
    let S_a = 0, S_au = 0;
    for (let j = 0; j < H; j++) {
      u[j] = (e[j] - mean) * stdInv;
      a[j] = dlnIn[j] * ln.weight[j];
      S_a += a[j]; S_au += a[j] * u[j];
    }
    const gln = new Array(H), gbLn = new Array(H).fill(0);
    const dEmb = new Array(H);
    for (let j = 0; j < H; j++) {
      gbLn[j] = dlnIn[j];
      gln[j]  = dlnIn[j] * u[j];
      dEmb[j] = stdInv * (a[j] - S_a / H - u[j] * S_au / H);
    }

    const gWemb = new Array(H * this.inputDim);
    for (let j = 0; j < H; j++) for (let i = 0; i < this.inputDim; i++) gWemb[j * this.inputDim + i] = dEmb[j] * x[i];

    return { loss, gWemb, gln, gbLn, gWffn, gbffn, gWhead, gbhead };
  }

  // ── FIELD_OPTIMIZER (Ch'en) — physics-driven update, once per epoch ─────
  _apply(acc) {
    this.phys.execute();
    const gate = this.phys.computeGravityGate();
    const decay = 1.0 - (this.steps > 0 ? this.epoch / this.steps : 0);
    const baseLr = this.lr * decay * clamp(0.7 + 0.3 * gate, 0.7, 1.3);
    const clip = clamp(gate, 0.5, 2.0);

    const head = this.node('LM_HEAD'), ffn = this.node('FFN'), ln = this.node('LAYERNORM'), embed = this.node('EMBED');
    const apply = (nodeIdx, w, g) => {
      const node = this.nodes[nodeIdx];
      const arcNorm = this.phys.arc_weights[nodeIdx % 1024] * Math.sqrt(1024);
      const boost = GRAVITY_BOOST[node.gravity] ?? 1.0;
      const lrN = baseLr * boost * clamp(arcNorm, 0.5, 2.0);
      const vel = this.velMap.get(this.keyOf(w));
      for (let i = 0; i < w.length; i++) {
        const gi = clamp(g[i], -clip, clip);
        vel[i] = this.momentum * vel[i] + (1 - this.momentum) * gi;
        w[i] -= lrN * vel[i];
      }
    };
    apply(N.EMBED,       embed.weight, acc.gWemb);
    apply(N.LAYERNORM,   ln.weight,    acc.gln);
    apply(N.LAYERNORM,   ln.bias,      acc.gbLn);
    apply(N.FFN,         ffn.weight,   acc.gWffn);
    apply(N.FFN,         ffn.bias,     acc.gbffn);
    apply(N.LM_HEAD,     head.weight,  acc.gWhead);
    apply(N.LM_HEAD,     head.bias,    acc.gbhead);

    this.phys.project();
    this.phys.consolidate(0.005);
  }

  _zeroGrads() {
    const H = this.hiddenDim;
    const z = (n) => new Array(n).fill(0);
    return {
      gWemb: z(H * this.inputDim), gln: z(H), gbLn: z(H),
      gWffn: z(H * H), gbffn: z(H),
      gWhead: z(this.outputDim * H), gbhead: z(this.outputDim),
    };
  }

  _accumulate(acc, g) {
    // element-wise SUM (all grad arrays are same length per key)
    for (const k of Object.keys(acc)) {
      const a = acc[k], b = g[k];
      for (let i = 0; i < a.length; i++) a[i] += b[i];
    }
  }

  _normalize(acc, n) {
    for (const k of Object.keys(acc)) {
      const arr = acc[k];
      for (let i = 0; i < arr.length; i++) arr[i] /= n;
    }
  }

  // ── train (full-batch: one K'UHUL phase cycle per epoch) ────────────────
  async train(dataset) {
    const probe = await this.probeGLSL();
    if (this.verbose) {
      const on = probe.kernels ? probe.kernels.filter(k => k.compiled).map(k => k.glyph).join(',') : '';
      console.log(`[trainer] GLSL kernels ${probe.gpu ? 'COMPILED (' + on + ')' : 'CPU fallback'}`);
    }

    // register semantic advisor with the skeleton
    if (this.semantic) {
      this.semantic.registerNodes(this.nodes);
    }

    const reportEvery = Math.max(1, Math.floor(this.steps / 10));
    for (let e = 0; e < this.steps; e++) {
      this.epoch = e;
      this.phys.perceive(0.002);
      this.phys.represent(0.002);

      // ── semantic reasoning over skeleton + physics ─────────────────────
      if (this.semantic && e % (this.semantic.interval || 1) === 0) {
        const state = this.phys.state();
        const metrics = {
          entropy: state.entropy,
          gravity: state.gravity,
          attention: state.attention,
          pressure: state.pressure,
          affinity: state.affinity,
        };
        const analysis = await this.semantic.analyze(this.nodes, metrics);
        this._semanticAdvice.push(analysis.advice);
        const adjusted = this.semantic.adjustStep({ lr: this.lr }, analysis.advice);
        if (adjusted.lr !== this.lr) {
          this.lr = clamp(adjusted.lr, 1e-6, 1.0);
        }
        if (adjusted.pressureDelta) {
          this.phys.pressure = clamp(this.phys.pressure + adjusted.pressureDelta, 0.0, 0.8);
        }
        if (adjusted.attentionDelta) {
          this.phys.attention = clamp(this.phys.attention + adjusted.attentionDelta, 0.2, 0.95);
        }
      }

      // Pop/Wo prefix, then accumulate LOSS over the dataset (Sek/Ch'en per sample)
      const acc = this._zeroGrads();
      let epochLoss = 0;
      for (const s of dataset) {
        const g = this._grads(s.x, s.y);
        this._accumulate(acc, g);
        epochLoss += g.loss;
      }
      this._normalize(acc, dataset.length);
      epochLoss /= dataset.length;
      // FIELD_OPTIMIZER applies once per epoch (Xul commits)
      this._apply(acc);
      this.losses.push(epochLoss);
      if (this.verbose && (e % reportEvery === 0 || e === this.steps - 1)) {
        const p = this.phys;
        console.log(`  epoch ${String(e).padStart(4)}  loss=${epochLoss.toFixed(6)}  lr=${this.lr.toFixed(6)}  ` +
          `g=${p.gravity.toFixed(3)} e=${p.entropy.toFixed(3)} a=${p.attention.toFixed(3)} aff=${p.affinity.toFixed(3)}`);
      }
    }
    return {
      losses: this.losses,
      gpu: this.gpuActive,
      physics: this.phys.state(),
      finalLoss: this.losses[this.losses.length - 1],
      semanticAdvice: this._semanticAdvice,
    };
  }

  // ── GLSL kernel validation through the transport (per node glyph) ────────
  async probeGLSL() {
    if (!this.transport) return { gpu: false, reason: 'no transport' };
    const probes = [
      { glyph: 'matmul',    kernel: this.kernels.MATMUL },
      { glyph: 'layernorm', kernel: this.kernels.LAYERNORM },
      { glyph: 'gelu',      kernel: this.kernels.GELU },
    ];
    const results = [];
    for (const p of probes) {
      const r = await this.transport('dispatch', {
        program: {
          name: `glsl_${p.glyph}`,
          '@control': [{ '@op': 'native.EVAL', '@fn': 'dispatch',
            '@source': p.kernel, '@profile': 'glsl', '@out': 'r' }],
          '@state': {},
        },
      });
      const c = r.ok && r.result && r.result.result && r.result.result.r;
      results.push({ glyph: p.glyph, compiled: !!(c && c.compiled) });
    }
    this.gpuActive = results.every(r => r.compiled);
    return { gpu: this.gpuActive, kernels: results };
  }

  predict(x) { return this.forward(x).y; }

  // ── export the trained skeleton as a KAST-like document ──────────────────
  model() {
    return {
      protocol: 'kast/1',
      source_kind: 'glsl-trainer',
      nodes: this.nodes.map(n => ({
        id: n.id, kind: 'node', fold: n.fold, lane: n.lane,
        glyph: n.glyph, opcode: n.opcode, gravity: n.gravity,
        symbol: n.symbol, shape: n.shape,
        weights: n.weight ? Array.from(n.weight) : null,
        bias: n.bias ? Array.from(n.bias) : null,
      })),
      edges: this.edges,
      physics: this.phys.state(),
      loss_history: this.losses,
    };
  }
}

module.exports = { GLSLTrainer, glslHttpTransport, NODE_SPECS, N };
