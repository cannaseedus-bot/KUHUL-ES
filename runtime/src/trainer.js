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
const { causalSelfAttentionForward, causalSelfAttentionBackward } = require('./attention');
const { powernautGlslTransport } = require('./transports/powernaut_glsl_transport');
const { xvmD3d12Transport, DEFAULT_XVM_DIR } = require('./transports/xvm_d3d12_transport');
const { hybridClusterGlslTransport } = require('./transports/hybrid_cluster_glsl_transport');
const http = require('http');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tanh = (v) => Math.tanh(v);
const gelu = (v) => {
  const c = clamp(v, -1000, 1000);
  const k = clamp(0.7978845608 * (c + 0.044715 * c * c * c), -20, 20);
  return 0.5 * c * (1 + tanh(k));
};
const geluDeriv = (v) => {
  const c = clamp(v, -1000, 1000);
  const arg = clamp(0.7978845608 * (c + 0.044715 * c * c * c), -20, 20);
  const t = tanh(arg);
  return 0.5 * (1 + t) + 0.5 * c * (1 - t * t) * (0.7978845608 * (1 + 3 * 0.044715 * c * c));
};

// ── semantic node pick (XCFE/KXML mapped) ───────────────────────────────────
const NODE_SPECS = [
  { id: 'EMBED',            fold: 'Pop',   lane: 'input',     glyph: 'embed',     opcode: 'EMBED',  gravity: 'Embed'  },
  { id: 'ATTN_QKV',         fold: 'Yax',   lane: 'attention', glyph: 'attention', opcode: 'QKV',    gravity: 'Heavy'  },
  { id: 'ATTN_PROJ',        fold: 'Yax',   lane: 'attention', glyph: 'attention', opcode: 'PROJ',   gravity: 'Heavy'  },
  { id: 'LAYERNORM',        fold: 'Wo',    lane: 'normalize', glyph: 'layernorm', opcode: 'LNORM', gravity: 'Heavy' },
  { id: 'FFN',              fold: 'Sek',   lane: 'compute',   glyph: 'gelu',      opcode: 'FFN',    gravity: 'Normal' },
  { id: 'LM_HEAD',          fold: 'Xul',   lane: 'output',    glyph: 'lm_head',   opcode: 'LMHEAD', gravity: 'Heavy' },
  { id: 'LOSS',             fold: 'Ch\'en', lane: 'verify',   glyph: 'mse',       opcode: 'LOSS',   gravity: 'Heavy' },
  { id: 'FIELD_OPTIMIZER',  fold: 'Ch\'en', lane: 'update',   glyph: 'physics',   opcode: 'OPTIM',  gravity: 'Normal' },
];

// node index for routing (matches NODE_SPECS order)
const N = { EMBED: 0, ATTN_QKV: 1, ATTN_PROJ: 2, LAYERNORM: 3, FFN: 4, LM_HEAD: 5, LOSS: 6, OPTIM: 7 };
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
    // General params
    this.inputDim  = opts.inputDim  ?? 1;       // numeric input dim (if not token mode)
    this.hiddenDim = opts.hiddenDim ?? 32;
    this.outputDim = opts.outputDim ?? 1;      // numeric output dim (or vocab size when token mode)
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

    // Token/embedding params (optional)
    this.vocabSize = opts.vocabSize || null;     // if set, enables token mode
    this.embedDim  = opts.embedDim || null;      // embedding dimension (if token mode)
    this.nHead     = opts.nHead || 4;            // attention heads (token mode)

    this._buildSkeleton();
  }

  // ── skeleton: tensors as semantic nodes ───────────────────────────────────
  _buildSkeleton() {
    const rnd = (n, s = 0.3) => Array.from({ length: n }, () => (Math.random() * 2 - 1) * s);
    const H = this.hiddenDim;

    // If vocabSize is set, build embedding-based skeleton; else numeric input skeleton
    if (this.vocabSize && this.embedDim) {
      const V = this.vocabSize;
      const D = this.embedDim;
      const nH = this.nHead;
      if (D % nH !== 0) throw new Error(`embedDim ${D} must be divisible by nHead ${nH}`);
      // Embedding matrix: [V, D]
      const embedWeight = rnd(V * D, 0.1);
      // QKV projection: [D, 3D]
      const qkvWeight = rnd(D * 3 * D, 0.1);
      const qkvBias = new Array(3 * D).fill(0);
      // Output projection: [D, D]
      const projWeight = rnd(D * D, 0.1);
      const projBias = new Array(D).fill(0);
      // FFN weight: [H, D]
      const ffnWeight = rnd(H * D, 0.1);
      // LM head: [V, H]
      const headWeight = rnd(V * H, 0.1);

      this.nodes = [
        { ...NODE_SPECS[N.EMBED], weight: embedWeight, bias: null, shape: [V, D], symbol: 'W_embed', artifact: 'model-weights/embed.bin' },
        { ...NODE_SPECS[N.ATTN_QKV], weight: qkvWeight, bias: qkvBias, shape: [D, 3 * D], symbol: 'W_attn_qkv', artifact: 'model-weights/attn_qkv.bin' },
        { ...NODE_SPECS[N.ATTN_PROJ], weight: projWeight, bias: projBias, shape: [D, D], symbol: 'W_attn_proj', artifact: 'model-weights/attn_proj.bin' },
        { ...NODE_SPECS[N.LAYERNORM], weight: new Array(D).fill(1), bias: new Array(D).fill(0), shape: [D], symbol: 'ln_gamma/beta' },
        { ...NODE_SPECS[N.FFN], weight: ffnWeight, bias: new Array(H).fill(0), shape: [H, D], symbol: 'W_ffn' },
        { ...NODE_SPECS[N.LM_HEAD], weight: headWeight, bias: new Array(V).fill(0), shape: [V, H], symbol: 'W_lm_head' },
        { ...NODE_SPECS[N.LOSS], weight: null, bias: null, shape: [], symbol: 'cross_entropy' },
        { ...NODE_SPECS[N.OPTIM], weight: null, bias: null, shape: [], symbol: 'physics' }
      ];
    } else {
      // numeric input path (legacy)
      this.nodes = [
        { ...NODE_SPECS[N.EMBED],       weight: rnd(H * this.inputDim),        bias: null, shape: [H, this.inputDim], symbol: 'W_embed' },
        { ...NODE_SPECS[N.ATTN_QKV],    weight: null,                           bias: null, shape: [H, 3 * H], symbol: 'W_attn_qkv' },
        { ...NODE_SPECS[N.ATTN_PROJ],   weight: null,                           bias: null, shape: [H, H], symbol: 'W_attn_proj' },
        { ...NODE_SPECS[N.LAYERNORM],   weight: new Array(H).fill(1),           bias: new Array(H).fill(0), shape: [H], symbol: 'ln_gamma/beta' },
        { ...NODE_SPECS[N.FFN],         weight: rnd(H * H),                     bias: new Array(H).fill(0), shape: [H, H], symbol: 'W_ffn' },
        { ...NODE_SPECS[N.LM_HEAD],     weight: rnd(this.outputDim * H),        bias: new Array(this.outputDim).fill(0), shape: [this.outputDim, H], symbol: 'W_lm_head' },
        { ...NODE_SPECS[N.LOSS],        weight: null, bias: null, shape: [], symbol: 'mse' },
        { ...NODE_SPECS[N.OPTIM], weight: null, bias: null, shape: [], symbol: 'physics' },
      ];
    }

    // control edges
    this.edges = [
      { from: 'EMBED', to: 'ATTN_QKV', kind: 'control', label: 'Pop->Yax' },
      { from: 'ATTN_QKV', to: 'ATTN_PROJ', kind: 'control', label: 'Yax->Yax' },
      { from: 'ATTN_PROJ', to: 'LAYERNORM', kind: 'control', label: 'Yax->Wo' },
      { from: 'LAYERNORM', to: 'FFN', kind: 'control', label: 'Wo->Sek' },
      { from: 'FFN', to: 'LM_HEAD', kind: 'control', label: 'Sek->Xul' },
      { from: 'LM_HEAD', to: 'LOSS', kind: 'control', label: 'Xul->Chen' },
      { from: 'LOSS', to: 'FIELD_OPTIMIZER', kind: 'control', label: 'Chen->update' }
    ];

    // momentum buffers
    this.velMap = new Map();
    const keyOf = (w) => w;
    for (const n of this.nodes) {
      if (n.weight) this.velMap.set(keyOf(n.weight), new Array(n.weight.length).fill(0));
      if (n.bias) this.velMap.set(keyOf(n.bias), new Array(n.bias.length).fill(0));
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
      h[j] = gelu(v);
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

  // ── token-mode forward helper ─────────────────────────────────────────
  _forwardToken(tokenIds) {
    const V = this.vocabSize;
    const D = this.embedDim;
    const H = this.hiddenDim;
    const nH = this.nHead;
    const lastToken = tokenIds[tokenIds.length - 1];
    const embedNode = this.node('EMBED');
    const ln = this.node('LAYERNORM');
    const ffn = this.node('FFN');
    const head = this.node('LM_HEAD');
    const qkvNode = this.node('ATTN_QKV');
    const projNode = this.node('ATTN_PROJ');

    // Build a simple sequence representation for attention: one token = [1, D]
    const seq = { array: new Float32Array(D), shape: [1, D] };
    for (let j = 0; j < D; j++) seq.array[j] = embedNode.weight[lastToken * D + j];

    // Attention block (single-token causal self-attention, still useful for gradient flow)
    const attn = causalSelfAttentionForward(
      seq,
      qkvNode.weight,
      qkvNode.bias,
      projNode.weight,
      projNode.bias,
      nH
    );
    const e = Array.from(attn.array); // residual output of attention [D]

    // layernorm
    let mean = 0, varSum = 0;
    for (let j = 0; j < D; j++) { mean += e[j]; varSum += e[j] * e[j]; }
    mean /= D; varSum = varSum / D - mean * mean;
    const z = new Array(D);
    for (let j = 0; j < D; j++) z[j] = (e[j] - mean) / Math.sqrt(varSum + 1e-5) * ln.weight[j] + ln.bias[j];

    // FFN: h = gelu(W_ffn @ z + b) (W_ffn is [H, D])
    const h = new Array(H);
    for (let j = 0; j < H; j++) {
      let s = ffn.bias[j] || 0;
      for (let k = 0; k < D; k++) s += ffn.weight[j * D + k] * z[k];
      const v = s;
      h[j] = gelu(v);
    }

    // LM head: logits over vocab (head.weight: [V, H])
    const logits = new Array(V);
    for (let o = 0; o < V; o++) {
      let s = head.bias[o] || 0;
      for (let j = 0; j < H; j++) s += head.weight[o * H + j] * h[j];
      logits[o] = s;
    }

    // softmax
    const maxLogit = Math.max(...logits);
    const expLogits = logits.map(l => Math.exp(l - maxLogit));
    const sumExp = expLogits.reduce((a, b) => a + b, 0);
    const probs = expLogits.map(l => l / sumExp);
    return { e, z, h, logits, probs, lastToken, attnCache: attn.cache };
  }

  // ── LOSS (Ch'en) — pure gradient computation for one sample ────────────
  // Generic gradient function: dispatches to token or numeric path
  _grads(x, target) {
    // Token-mode: x is array of token IDs and target is a token ID (number)
    if (Array.isArray(x) && typeof target === 'number' && this.vocabSize && this.embedDim) {
      return this._gradsToken(x, target);
    }
    // Numeric fallback (legacy MSE path)
    return this._gradsNumeric(x, target);
  }

  _gradsNumeric(x, target) {
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
      const dgelu = geluDeriv(s);
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

  _gradsToken(tokenIds, targetId) {
    // tokenIds: array of token ids (seq); use last token as context
    const V = this.vocabSize;
    const D = this.embedDim;
    const H = this.hiddenDim;

    const { e, z, h, logits, probs, lastToken, attnCache } = this._forwardToken(tokenIds);

    // softmax cross-entropy + grad
    const loss = -Math.log(probs[targetId] + 1e-12);
    const dLogits = probs.map((p, i) => p - (i === targetId ? 1 : 0));

    // Gradients for head: gWhead = outer(dLogits, h)
    const gWhead = new Array(V * H);
    const gbhead = new Array(V).fill(0);
    for (let o = 0; o < V; o++) {
      gbhead[o] = dLogits[o];
      for (let j = 0; j < H; j++) gWhead[o * H + j] = dLogits[o] * h[j];
    }

    // dL/dh = W_head^T @ dLogits
    const dh = new Array(H).fill(0);
    for (let j = 0; j < H; j++) {
      for (let o = 0; o < V; o++) dh[j] += dLogits[o] * this.nodes[N.LM_HEAD].weight[o * H + j];
    }

    // Backprop through FFN & GELU -> get dlnIn (size D)
    const ffn = this.node('FFN');
    const gWffn = new Array(H * D).fill(0);
    const gbffn = new Array(H).fill(0);
    const dlnIn = new Array(D).fill(0);

    for (let j = 0; j < H; j++) {
      let s = ffn.bias[j] || 0;
      for (let k = 0; k < D; k++) s += ffn.weight[j * D + k] * z[k];
      const t = tanh(0.7978845608 * (s + 0.044715 * s * s * s));
      const dgelu = geluDeriv(s);
      const dj = dh[j] * dgelu;
      gbffn[j] = dj;
      for (let k = 0; k < D; k++) gWffn[j * D + k] = dj * z[k];
      for (let k = 0; k < D; k++) dlnIn[k] += dj * ffn.weight[j * D + k];
    }

    // Layer norm backprop
    const ln = this.node('LAYERNORM');
    let varSum = 0, m = 0;
    for (let j = 0; j < D; j++) { m += e[j]; varSum += e[j] * e[j]; }
    m /= D; varSum = varSum / D - m * m;
    const stdInv = 1 / Math.sqrt(varSum + 1e-5);
    const u = new Array(D);
    let S_a = 0, S_au = 0;
    for (let j = 0; j < D; j++) {
      u[j] = (e[j] - m) * stdInv;
      const a = dlnIn[j] * ln.weight[j];
      S_a += a; S_au += a * u[j];
    }
    const gln = new Array(D).fill(0);
    const gbLn = new Array(D).fill(0);
    const dAttnOut = new Array(D).fill(0);
    for (let j = 0; j < D; j++) {
      gbLn[j] = dlnIn[j];
      gln[j] = dlnIn[j] * u[j];
      dAttnOut[j] = stdInv * (dlnIn[j] * ln.weight[j] - S_a / D - u[j] * S_au / D);
    }

    // Backprop through attention
    const qkvNode = this.node('ATTN_QKV');
    const projNode = this.node('ATTN_PROJ');
    const attnB = causalSelfAttentionBackward(
      dAttnOut,
      qkvNode.weight,
      qkvNode.bias,
      projNode.weight,
      projNode.bias,
      this.nHead,
      attnCache
    );

    // Gradients for attention weights
    const gWqkv = attnB.gWqkv;
    const gbqkv = attnB.gbqkv;
    const gWproj = attnB.gWproj;
    const gbproj = attnB.gbproj;

    // Embedding gradient: attention dX flows back to the single token embedding row
    const gWemb = new Array(this.vocabSize * D).fill(0);
    const off = lastToken * D;
    for (let j = 0; j < D; j++) gWemb[off + j] = attnB.dX.array[j];

    return { loss, probs, gWemb, gWqkv, gbqkv, gWproj, gbproj, gln, gbLn, gWffn, gbffn, gWhead, gbhead, targetId };
  }

  // ── FIELD_OPTIMIZER (Ch'en) — physics-driven update, once per epoch ─────
  _apply(acc) {
    this.phys.execute();
    const gate = this.phys.computeGravityGate();
    const decay = 1.0 - (this.steps > 0 ? this.epoch / this.steps : 0);
    const baseLr = this.lr * decay * clamp(0.7 + 0.3 * gate, 0.7, 1.3);
    const clip = clamp(gate, 0.5, 2.0);

    const head = this.node('LM_HEAD'), ffn = this.node('FFN'), ln = this.node('LAYERNORM'), embed = this.node('EMBED');
    const qkvNode = this.node('ATTN_QKV');
    const projNode = this.node('ATTN_PROJ');
    const apply = (nodeIdx, w, g) => {
      if (!w || !g) return;
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
    apply(N.ATTN_QKV,    qkvNode.weight, acc.gWqkv);
    apply(N.ATTN_QKV,    qkvNode.bias,   acc.gbqkv);
    apply(N.ATTN_PROJ,   projNode.weight, acc.gWproj);
    apply(N.ATTN_PROJ,   projNode.bias,   acc.gbproj);
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
    const z = (n) => new Array(n).fill(0);
    if (this.vocabSize && this.embedDim) {
      const V = this.vocabSize, D = this.embedDim, H = this.hiddenDim;
      return {
        gWemb: z(V * D), gWqkv: z(D * 3 * D), gbqkv: z(3 * D),
        gWproj: z(D * D), gbproj: z(D),
        gln: z(D), gbLn: z(D),
        gWffn: z(H * D), gbffn: z(H),
        gWhead: z(V * H), gbhead: z(V),
      };
    }
    const H = this.hiddenDim;
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
    const extractCompileInfo = (response) => {
      if (!response || !response.ok) {
        return { compiled: false, backend: null };
      }
      const nested = response?.result?.result?.r;
      if (nested && typeof nested.compiled === 'boolean') {
        return {
          compiled: nested.compiled,
          backend: nested.backend || null,
        };
      }
      if (response?.result && typeof response.result.compiled === 'boolean') {
        return {
          compiled: response.result.compiled,
          backend: response.result.backend || null,
        };
      }
      // powernaut transport returns { ok, status, data }
      if (response?.status === 200 || response?.data) {
        return { compiled: true, backend: 'glsl-sidecar' };
      }
      // xvm binary transport returns { ok, code, stdout }
      if (typeof response?.code === 'number') {
        return { compiled: response.code === 0, backend: 'xvm' };
      }
      return { compiled: !!response.ok, backend: null };
    };

    const probes = [
      { glyph: 'matmul',    kernel: this.kernels.MATMUL },
      { glyph: 'layernorm', kernel: this.kernels.LAYERNORM },
      { glyph: 'gelu',      kernel: this.kernels.GELU },
    ];
    const results = [];
    for (const p of probes) {
      const started = Date.now();
      const r = await this.transport('dispatch', {
        program: {
          name: `glsl_${p.glyph}`,
          '@control': [{ '@op': 'native.EVAL', '@fn': 'dispatch',
            '@source': p.kernel, '@profile': 'glsl', '@out': 'r' }],
          '@state': {},
        },
      });
      const info = extractCompileInfo(r);
      results.push({
        glyph: p.glyph,
        compiled: !!info.compiled,
        backend: info.backend,
        elapsed_ms: Date.now() - started,
      });
    }
    this.gpuActive = results.every(r => r.compiled);
    return { gpu: this.gpuActive, kernels: results };
  }

  predict(x) { return this.forward(x).y; }

  // ── greedy / top-k token generation ─────────────────────────────────
  generate(seedTokenIds, count, topK = 1) {
    if (!this.vocabSize || !this.embedDim) {
      throw new Error('generate() requires token mode (vocabSize + embedDim)');
    }
    const tokens = seedTokenIds.slice();
    for (let i = 0; i < count; i++) {
      const { probs } = this._forwardToken(tokens);
      let next;
      if (topK <= 1) {
        next = probs.indexOf(Math.max(...probs));
      } else {
        const indexed = probs.map((p, idx) => ({ p, idx }));
        indexed.sort((a, b) => b.p - a.p);
        const top = indexed.slice(0, topK);
        const mass = top.reduce((s, t) => s + t.p, 0);
        let r = Math.random() * mass;
        next = top[top.length - 1].idx;
        for (const t of top) {
          r -= t.p;
          if (r <= 0) { next = t.idx; break; }
        }
      }
      tokens.push(next);
    }
    return tokens;
  }

  // ── export the trained skeleton as a KAST-like semantic manifest ────────
  model(opts = {}) {
    const artifacts = [];
    const nodes = this.nodes.map(n => {
      const artifact = n.weight ? (n.artifact || `model-weights/${n.id.toLowerCase()}.bin`) : null;
      const biasArtifact = n.bias ? (n.artifact ? n.artifact.replace('.bin', '_bias.bin') : `model-weights/${n.id.toLowerCase()}_bias.bin`) : null;
      if (artifact) artifacts.push({ id: `${n.id}_weights`, path: artifact, shape: n.shape, dtype: 'float32' });
      if (biasArtifact) artifacts.push({ id: `${n.id}_bias`, path: biasArtifact, shape: [n.bias.length], dtype: 'float32' });
      return {
        id: n.id, kind: 'node', fold: n.fold, lane: n.lane,
        glyph: n.glyph, opcode: n.opcode, gravity: n.gravity,
        symbol: n.symbol, shape: n.shape,
        weights: artifact,
        bias: biasArtifact,
      };
    });

    const folds = [...new Set(this.nodes.map(n => n.fold).filter(Boolean))].map((foldId, idx) => ({
      id: foldId,
      phase: PHASE_CYCLE[idx % PHASE_CYCLE.length],
      axis: 'vertical',
      state: 'committed',
      parent: null,
      depth: 0,
      nodes: nodes.filter(n => n.fold === foldId).map(n => n.id),
      unfolds: [],
    }));

    return {
      protocol: 'kast/1',
      source_kind: 'glsl-trainer',
      nodes,
      edges: this.edges,
      folds,
      artifacts,
      physics: this.phys.state(),
      loss_history: this.losses,
      tokenizer: opts.tokenizer || (this.vocabSize ? {
        vocab_size: this.vocabSize,
        embed_dim: this.embedDim,
        format: 'inline',
      } : null),
    };
  }
}

module.exports = {
  GLSLTrainer,
  glslHttpTransport,
  powernautGlslTransport,
  hybridClusterGlslTransport,
  xvmD3d12Transport,
  DEFAULT_XVM_DIR,
  NODE_SPECS,
  N,
};
