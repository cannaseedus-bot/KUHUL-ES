// runtime/src/kxml_driver.js
//
// JavaScript port of tools/kxml_inference_driver.py.
//
// Walks a KHANARY model manifest's forward_graph and executes each K'UHUL glyph
// (G_EMBED, G_LAYERNORM, G_MATMUL, G_ATTENTION, G_GELU) using plain JS numeric
// kernels. Maps every graph step to a KAST-like node (fold/opcode/symbol) so the
// model execution becomes a semantic runtime trace.
//
// Inputs:
//   - manifest JSON (khanary-model-stb/v1)
//   - weights from readStb()
//
// Outputs:
//   - logits or generated tokens
//   - semantic trace of folds/nodes executed

'use strict';

const { readStbFile } = require('./stb_reader');
const { emitTemplate, renderForGguf } = require('./kxml_chat');

// ── pure-JS op kernels (numpy mirrors of the verified KNU glyphs) ─────────────
function opEmbed(tokens, wte, wpe) {
  // tokens: array of int token ids
  // wte: [vocab, n_embd]
  // wpe: [n_ctx, n_embd]
  const S = tokens.length;
  const E = wte.shape[1];
  const out = new Float32Array(S * E);
  for (let s = 0; s < S; s++) {
    const tok = tokens[s];
    for (let e = 0; e < E; e++) {
      out[s * E + e] = wte.array[tok * E + e] + wpe.array[s * E + e];
    }
  }
  return { array: out, shape: [S, E] };
}

function opLayerNorm(x, gamma, beta, eps = 1e-5) {
  // x: {array, shape}
  const [S, E] = x.shape;
  const out = new Float32Array(S * E);
  for (let s = 0; s < S; s++) {
    let mean = 0, varSum = 0;
    for (let e = 0; e < E; e++) {
      const v = x.array[s * E + e];
      mean += v;
      varSum += v * v;
    }
    mean /= E;
    const variance = varSum / E - mean * mean;
    const invStd = 1 / Math.sqrt(variance + eps);
    for (let e = 0; e < E; e++) {
      out[s * E + e] = ((x.array[s * E + e] - mean) * invStd) * gamma.array[e] + beta.array[e];
    }
  }
  return { array: out, shape: [S, E] };
}

function opMatmul(x, B, bias, transposeB = false) {
  // GPT-2 Conv1D: x @ B (B is [E_in, E_out])
  const [M, K] = x.shape;
  const N = transposeB ? B.shape[0] : B.shape[1];
  const Kb = transposeB ? B.shape[1] : B.shape[0];
  if (K !== Kb) throw new Error(`Matmul shape mismatch: x=[${M},${K}] B=[${B.shape.join(',')}]`);
  const out = new Float32Array(M * N);
  for (let m = 0; m < M; m++) {
    for (let n = 0; n < N; n++) {
      let acc = bias ? bias.array[n] : 0;
      for (let k = 0; k < K; k++) {
        const bIdx = transposeB ? n * Kb + k : k * N + n;
        acc += x.array[m * K + k] * B.array[bIdx];
      }
      out[m * N + n] = acc;
    }
  }
  return { array: out, shape: [M, N] };
}

function opGelu(x) {
  const n = x.array.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = x.array[i];
    const k = Math.max(-10, Math.min(10, 0.7978845608 * (v + 0.044715 * v * v * v)));
    out[i] = 0.5 * v * (1 + Math.tanh(k));
  }
  return { array: out, shape: x.shape };
}

function opAttention(qkv, nHead, headDim) {
  const S = qkv.shape[0];
  const E = nHead * headDim;
  const out = new Float32Array(S * E);
  const scale = 1.0 / Math.sqrt(headDim);
  for (let h = 0; h < nHead; h++) {
    const hOff = h * headDim;
    for (let s = 0; s < S; s++) {
      const scores = new Float32Array(s + 1);
      let maxScore = -Infinity;
      for (let t = 0; t <= s; t++) {
        let score = 0;
        for (let d = 0; d < headDim; d++) {
          const qv = qkv.array[s * 3 * E + hOff + d];
          const kv = qkv.array[t * 3 * E + E + hOff + d];
          score += qv * kv;
        }
        score *= scale;
        scores[t] = score;
        maxScore = Math.max(maxScore, score);
      }
      let sumExp = 0;
      for (let t = 0; t <= s; t++) {
        scores[t] = Math.exp(scores[t] - maxScore);
        sumExp += scores[t];
      }
      for (let d = 0; d < headDim; d++) {
        let acc = 0;
        for (let t = 0; t <= s; t++) {
          const vv = qkv.array[t * 3 * E + 2 * E + hOff + d];
          acc += scores[t] * vv;
        }
        out[s * E + hOff + d] = acc / sumExp;
      }
    }
  }
  return { array: out, shape: [S, E] };
}

// ── KXML node-to-fold mapping (semantic runtime trace) ───────────────────────
const GLYPH_TO_FOLD = {
  G_EMBED: 'Pop',
  G_LAYERNORM: 'Wo',
  G_MATMUL: 'Sek',
  G_ATTENTION: 'Sek',
  G_GELU: 'Sek',
};

function nodeFromStep(step, cfg) {
  const fold = GLYPH_TO_FOLD[step.glyph] || 'Sek';
  const operands = [];
  const reads = step.reads || {};
  for (const [name, ref] of Object.entries(reads)) {
    if (typeof ref === 'object' && ref !== null) {
      operands.push({ name, id: ref.id !== undefined ? ref.id : null, tensor: ref.name || null });
    } else {
      operands.push({ name, value: ref });
    }
  }
  if (step.bias) operands.push({ name: 'bias', tensor: step.bias });
  return {
    id: step.step,
    kind: 'node',
    fold,
    lane: 'compute',
    glyph: step.glyph,
    opcode: step.glyph.replace('G_', ''),
    symbol: step.step,
    gravity: step.glyph === 'G_LAYERNORM' || step.glyph === 'G_MATMUL' ? 'Heavy' : 'Normal',
    params: step.params || {},
    operands,
  };
}

class KxmlModel {
  constructor(manifest, weights) {
    this.manifest = manifest;
    this.cfg = manifest.config;
    this.graph = manifest.forward_graph || [];
    this.name2id = {};
    if (manifest.tensors) {
      for (const [name, t] of Object.entries(manifest.tensors)) {
        this.name2id[name] = t.id;
      }
    }
    this.W = weights;
    this.trace = [];
  }

  static async fromFiles(stbPath, manifestPath) {
    const fs = require('fs');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const weights = await readStbFile(stbPath);
    return new KxmlModel(manifest, weights);
  }

  static fromBuffers(stbBuffer, manifestJson) {
    const { readStb } = require('./stb_reader');
    const weights = readStb(stbBuffer);
    return new KxmlModel(manifestJson, weights);
  }

  _t(ref) {
    if (typeof ref === 'object' && ref !== null && ref.id !== undefined) {
      return this.W[ref.id];
    }
    if (typeof ref === 'string') {
      return this.W[this.name2id[ref]];
    }
    throw new Error(`Bad tensor ref: ${JSON.stringify(ref)}`);
  }

  forward(tokens) {
    let x = null;
    let residual = null;
    this.trace = [];

    for (const step of this.graph) {
      const glyph = step.glyph;
      const reads = step.reads || {};
      this.trace.push(nodeFromStep(step, this.cfg));

      if (glyph === 'G_EMBED') {
        x = opEmbed(tokens, this._t(reads.wte), this._t(reads.wpe));
      } else if (glyph === 'G_LAYERNORM') {
        if (!step.step.startsWith('ln_f')) {
          residual = x;
        }
        x = opLayerNorm(x, this._t(reads.gamma), this._t(reads.beta), this.cfg.ln_eps);
      } else if (glyph === 'G_MATMUL') {
        const bias = step.bias ? this._t(step.bias) : null;
        x = opMatmul(x, this._t(reads.B), bias, step.transpose_B || false);
        if (step.residual && residual) {
          for (let i = 0; i < x.array.length; i++) x.array[i] += residual.array[i];
        }
      } else if (glyph === 'G_ATTENTION') {
        const params = step.params || {};
        x = opAttention(x, params.n_head || this.cfg.n_head, params.head_dim || (this.cfg.n_embd / this.cfg.n_head));
      } else if (glyph === 'G_GELU') {
        x = opGelu(x);
      } else {
        throw new Error(`Unknown glyph ${glyph}`);
      }
    }

    return x;
  }

  generate(tokens, n = 8, greedy = true) {
    const toks = tokens.slice();
    const nCtx = this.cfg.n_ctx || 1024;
    for (let i = 0; i < n; i++) {
      const logits = this.forward(toks.slice(-nCtx));
      const lastRow = logits.shape[0] - 1;
      const vocab = logits.shape[1];
      let bestIdx = 0;
      let bestVal = -Infinity;
      for (let v = 0; v < vocab; v++) {
        const val = logits.data[lastRow * vocab + v];
        if (val > bestVal) {
          bestVal = val;
          bestIdx = v;
        }
      }
      toks.push(bestIdx);
    }
    return toks;
  }

  toKast() {
    const folds = [];
    let prevId = null;
    let prevName = null;
    for (let i = 0; i < this.trace.length; i++) {
      const traceNode = this.trace[i];
      const phase = traceNode.fold;
      const id = `fold-${i}-${phase}`;
      const fold = {
        id,
        phase,
        axis: 'vertical',
        state: 'committed',
        parent: prevId,
        depth: i,
        nodes: [{
          id: traceNode.id,
          index: 0,
          axis: 'linear',
          lane: traceNode.lane,
          glyph: traceNode.glyph,
          opcode: traceNode.opcode,
          symbol: traceNode.symbol,
          operands: traceNode.operands || [],
          attributes: { gravity: traceNode.gravity, params: traceNode.params },
        }],
        unfolds: [],
        attributes: {},
      };
      if (prevId) {
        folds[folds.length - 1].unfolds.push({ target: id, gate: 'always', ordinal: 0 });
      }
      folds.push(fold);
      prevId = id;
      prevName = phase;
    }
    return {
      protocol: 'kfold/1',
      entry_fold: folds.length > 0 ? folds[0].id : null,
      folds,
      semantic_hash: null,
      source_kind: 'kxml-model',
      config: this.cfg,
    };
  }
}

module.exports = {
  KxmlModel,
  opEmbed,
  opLayerNorm,
  opMatmul,
  opGelu,
  opAttention,
  GLYPH_TO_FOLD,
  emitTemplate,
  renderForGguf,
};
