// runtime/src/attention.js
// Minimal causal multi-head self-attention for the token-mode GLSLTrainer.
// Pure-JS reference implementation with forward + backward passes.

'use strict';

function causalSelfAttentionForward(x, Wqkv, bqkv, Wproj, bproj, nHead) {
  const S = x.shape[0];
  const D = x.shape[1];
  if (D % nHead !== 0) throw new Error(`embedDim ${D} not divisible by nHead ${nHead}`);
  const headDim = D / nHead;
  const scale = 1.0 / Math.sqrt(headDim);

  // 1) QKV projection
  const qkv = new Array(S * 3 * D).fill(0);
  for (let s = 0; s < S; s++) {
    for (let j = 0; j < 3 * D; j++) {
      let sum = bqkv ? bqkv[j] : 0;
      const xOff = s * D;
      const wOff = j;
      for (let k = 0; k < D; k++) sum += x.array[xOff + k] * Wqkv[k * 3 * D + wOff];
      qkv[s * 3 * D + j] = sum;
    }
  }

  // 2) Causal scaled-dot-product attention per head
  const attnOut = new Array(S * D).fill(0); // pre-projection concatenated head outputs
  const probs = []; // store per (s,h) softmax weights for backward

  for (let h = 0; h < nHead; h++) {
    const qBase = h * headDim;
    const kBase = D + h * headDim;
    const vBase = 2 * D + h * headDim;
    for (let s = 0; s < S; s++) {
      const scores = new Array(s + 1);
      let maxScore = -Infinity;
      for (let t = 0; t <= s; t++) {
        let dot = 0;
        for (let d = 0; d < headDim; d++) {
          dot += qkv[s * 3 * D + qBase + d] * qkv[t * 3 * D + kBase + d];
        }
        dot *= scale;
        scores[t] = dot;
        maxScore = Math.max(maxScore, dot);
      }
      let sumExp = 0;
      for (let t = 0; t <= s; t++) {
        scores[t] = Math.exp(scores[t] - maxScore);
        sumExp += scores[t];
      }
      for (let t = 0; t <= s; t++) scores[t] /= sumExp;
      probs.push({ s, h, scores });

      for (let d = 0; d < headDim; d++) {
        let acc = 0;
        for (let t = 0; t <= s; t++) {
          acc += scores[t] * qkv[t * 3 * D + vBase + d];
        }
        attnOut[s * D + h * headDim + d] = acc;
      }
    }
  }

  // 3) Output projection with residual: out = x + attnOut @ Wproj.T + bproj
  const out = new Array(S * D);
  for (let s = 0; s < S; s++) {
    for (let j = 0; j < D; j++) {
      let sum = bproj ? bproj[j] : 0;
      for (let k = 0; k < D; k++) {
        sum += attnOut[s * D + k] * Wproj[k * D + j];
      }
      out[s * D + j] = x.array[s * D + j] + sum;
    }
  }

  return {
    array: out,
    shape: [S, D],
    cache: { x, qkv, attnOut, probs, headDim, nHead, scale },
  };
}

function causalSelfAttentionBackward(dOut, Wqkv, bqkv, Wproj, bproj, nHead, cache) {
  const S = cache.x.shape[0];
  const D = cache.x.shape[1];
  const headDim = cache.headDim;
  const scale = cache.scale;
  const x = cache.x.array;
  const qkv = cache.qkv;
  const attnOut = cache.attnOut;
  const probs = cache.probs;

  // 1) Gradients through output projection + residual
  const gWproj = new Array(D * D).fill(0);
  const gbproj = new Array(D).fill(0);
  const dAttn = new Array(S * D).fill(0);

  for (let s = 0; s < S; s++) {
    for (let j = 0; j < D; j++) {
      const d = dOut[s * D + j];
      gbproj[j] += d;
      for (let k = 0; k < D; k++) {
        gWproj[k * D + j] += attnOut[s * D + k] * d;
        dAttn[s * D + k] += d * Wproj[k * D + j];
      }
    }
  }

  // 2) Backprop through causal attention into Q,K,V
  const dQkv = new Array(S * 3 * D).fill(0);

  for (const p of probs) {
    const { s, h, scores } = p;
    const qBase = h * headDim;
    const kBase = D + h * headDim;
    const vBase = 2 * D + h * headDim;
    for (let t = 0; t <= s; t++) {
      let dot = 0;
      for (let d = 0; d < headDim; d++) {
        const o = attnOut[s * D + h * headDim + d];
        const v = qkv[t * 3 * D + vBase + d];
        dot += dAttn[s * D + h * headDim + d] * (v - o);
      }
      const dScore = scores[t] * dot;
      for (let d = 0; d < headDim; d++) {
        dQkv[t * 3 * D + vBase + d] += scores[t] * dAttn[s * D + h * headDim + d];
        dQkv[s * 3 * D + qBase + d] += dScore * qkv[t * 3 * D + kBase + d] * scale;
        dQkv[t * 3 * D + kBase + d] += dScore * qkv[s * 3 * D + qBase + d] * scale;
      }
    }
  }

  // 3) Backprop through QKV projection into dX and gradients
  const gWqkv = new Array(D * 3 * D).fill(0);
  const gbqkv = new Array(3 * D).fill(0);
  const dX = new Array(S * D).fill(0);

  for (let s = 0; s < S; s++) {
    for (let j = 0; j < 3 * D; j++) {
      const d = dQkv[s * 3 * D + j];
      gbqkv[j] += d;
      for (let k = 0; k < D; k++) {
        gWqkv[k * 3 * D + j] += x[s * D + k] * d;
        dX[s * D + k] += d * Wqkv[k * 3 * D + j];
      }
    }
  }

  // 4) Residual branch
  for (let i = 0; i < dOut.length; i++) dX[i] += dOut[i];

  return { gWqkv, gbqkv, gWproj, gbproj, dX: { array: dX, shape: [S, D] } };
}

module.exports = { causalSelfAttentionForward, causalSelfAttentionBackward };
