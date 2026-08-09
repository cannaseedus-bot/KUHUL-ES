// kuhul-es/runtime/src/physics.js
//
// K'UHUL Physics Engine — the semantic physics of the phase machine.
//
// Matches the FieldExecutionEngine formulas (SEMANTIC_ENGINE.md):
//   gravity_gate = clamp(1.0 + 0.35*pressure - 0.25*entropy
//                          + 0.15*attention + 0.10*affinity, 0.1, 4.0)
//   gravity      = 9.80665 * gravity_gate
//   arc_bias[i]  = 1.0 + 0.10*attention - 0.08*entropy
//                        + 0.06*pressure + 0.04*affinity
//   arc_weight[i]= clamp((1/sqrt(1024)) * arc_bias[i], 0.01, 2.0)
//   velocity[i]  = 0.001 * (attention - entropy) * (1 + i%7)
//
// Phase hooks (Pop -> Wo -> Yax -> Sek -> Ch'en -> Xul):
//   Pop   perceive: affinity += delta, entropy decays
//   Wo    represent: pressure builds (representation load)
//   Yax   plan: attention focuses (decision pressure)
//   Sek   execute: attention spikes, pressure drains (compute spent)
//   Ch'en project: entropy rises (output entropy)
//   Xul   consolidate: gravity scales up (antigravity -> 1.0, like the trainer)

const DIM = 1024;
const EARTH_G = 9.80665;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class KuhulPhysics {
  constructor() {
    this.reset();
  }

  reset() {
    this.entropy   = 0.14;   // thermodynamic entropy of the field
    this.attention = 0.72;   // attention pressure (how focused)
    this.pressure  = 0.34;   // manifold pressure
    this.gravity   = EARTH_G;
    this.affinity  = 0.0;    // fold replay affinity
    this.arc_weights  = new Array(DIM).fill(1 / Math.sqrt(DIM));
    this.metric_tensor = new Array(DIM).fill(0.1);
    this.tick = 0;
    this.history = [];
  }

  // gravity gate + arc weights (FieldExecutionEngine formulas)
  computeGravityGate() {
    return clamp(
      1.0 + 0.35 * this.pressure - 0.25 * this.entropy
          + 0.15 * this.attention + 0.10 * this.affinity,
      0.1, 4.0
    );
  }

  updateGravity() {
    this.gravity = EARTH_G * this.computeGravityGate();
    return this.gravity;
  }

  updateArcWeights() {
    const scale = 1 / Math.sqrt(DIM);
    for (let i = 0; i < DIM; i++) {
      const bias = 1.0 + 0.10 * this.attention - 0.08 * this.entropy
                        + 0.06 * this.pressure + 0.04 * this.affinity;
      this.arc_weights[i] = clamp(scale * bias, 0.01, 2.0);
    }
    return this.arc_weights;
  }

  velocity(i) {
    return 0.001 * (this.attention - this.entropy) * (1 + i % 7);
  }

  // ── phase hooks (mean-reverting — oscillate in a healthy band, never saturate) ──

  perceive(deltaAffinity = 0.05) {
    this.affinity = clamp(this.affinity + deltaAffinity, 0.0, 1.0);
    this.entropy  = clamp(this.entropy * 0.95, 0.01, 0.5);
    this._tick('Pop');
  }

  represent(load = 0.04) {
    this.pressure = clamp(0.9 * this.pressure + load, 0.0, 0.8);
    this.affinity = clamp(this.affinity + 0.02, 0.0, 1.0);
    this._tick('Wo');
  }

  plan(focus = 0.03) {
    this.attention = clamp(0.92 * this.attention + focus, 0.2, 0.95);
    this.pressure  = clamp(0.95 * this.pressure + 0.01, 0.0, 0.8);
    this._tick('Yax');
  }

  execute(spend = 0.05) {
    this.attention = clamp(0.85 * this.attention + 0.06, 0.2, 0.95);  // compute focus
    this.pressure  = clamp(0.9 * this.pressure - spend + 0.03, 0.0, 0.8);
    this._tick('Sek');
  }

  project() {
    this.entropy = clamp(0.9 * this.entropy + 0.03, 0.01, 0.5);        // output entropy
    this._tick('Ch\'en');
  }

  consolidate(scaleUp = 0.1) {
    // antigravity -> 1.0 as training stabilises (trainer KuhulPhysics)
    this.affinity = clamp(this.affinity + scaleUp, 0.0, 1.0);
    this.updateGravity();
    this._tick('Xul');
  }

  reflect(decay = 0.03) {
    // reflection: attention consolidates, manifold pressure decays,
    // entropy stays bounded. Used by the thinking engine (Noj glyph).
    this.attention = clamp(0.94 * this.attention + 0.03, 0.2, 0.95);
    this.pressure  = clamp(0.85 * this.pressure - decay, 0.0, 0.8);
    this.entropy   = clamp(this.entropy * 0.97, 0.01, 0.5);
    this._tick('Noj');
  }

  _tick(phase) {
    this.tick++;
    this.updateGravity();
    this.updateArcWeights();
    // deterministic snapshot for the hash chain
    const snap = {
      tick: this.tick,
      phase,
      entropy:   +this.entropy.toFixed(5),
      attention: +this.attention.toFixed(5),
      pressure:  +this.pressure.toFixed(5),
      gravity:   +this.gravity.toFixed(5),
      affinity:  +this.affinity.toFixed(5),
      arc0:      +this.arc_weights[0].toFixed(6),
      velocity0: +this.velocity(0).toFixed(6),
    };
    this.history.push(snap);
    return snap;
  }

  state() {
    return {
      entropy: this.entropy, attention: this.attention,
      pressure: this.pressure, gravity: this.gravity,
      affinity: this.affinity, tick: this.tick,
      arc_weights: this.arc_weights, history: this.history,
    };
  }
}

module.exports = { KuhulPhysics, DIM, EARTH_G };
