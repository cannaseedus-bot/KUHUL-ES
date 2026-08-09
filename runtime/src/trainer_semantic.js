// runtime/src/trainer_semantic.js
//
// Semantic reasoning layer for the GLSL trainer.
//
// The trainer builds a K'UHUL skeleton: every tensor node is tagged with a
// fold, lane, glyph, opcode, gravity class, and symbol. This module turns
// those nodes plus live physics metrics into KAST propositions, runs them
// through the pattern reasoner, and returns semantic priors that can
// influence the FIELD_OPTIMIZER update step.
//
// Propositions are simple identifiers like:
//   fold:Sek node:FFN op:FFN symbol:W_ffn
//   metric:entropy=0.42000 phase:Noj
//
// Rules can detect structural patterns (repeated folds, heavy gravity nodes,
// high entropy on output lanes) and emit advice such as:
//   { target: 'lr', action: 'scale', value: 0.8, reason: 'heavy gravity repeats' }

'use strict';

const { SemanticPatternReasoner, nodeProposition, metricProposition } = require('./pattern_reasoner');

// Default semantic rules for training skeletons.
// They reason about folds/nodes/metrics, not weights.
const DEFAULT_TRAINING_RULES = [
  {
    name: 'heavy-gravity-node',
    pattern: '^fold:(\\w+) node:(\\w+) op:(\\w+) symbol:(\\w+)$',
    transform: ([fold, node, op, symbol], memory, m) => {
      if (memory.get(`gravity:${node}`) === 'Heavy') {
        return {
          proposition: `advise: lower lr for ${node} (${fold}/${symbol}) because gravity=Heavy`,
          fold: 'Yax',
          confidence: 0.75,
          advice: { target: 'lr', node, action: 'scale', value: 0.85 },
        };
      }
      return null;
    },
  },
  {
    name: 'output-fold-high-entropy',
    pattern: '^metric:entropy=([0-9.]+)$',
    transform: ([valStr], memory) => {
      const v = parseFloat(valStr);
      if (v > 0.35) {
        return {
          proposition: 'advise: entropy high; consolidate before next projection',
          fold: 'Ch\'en',
          confidence: 0.85,
          advice: { target: 'phase', action: 'insert', value: 'Xul' },
        };
      }
      return null;
    },
  },
  {
    name: 'fold-loop',
    pattern: '^(fold:\\w+).*\\1',
    transform: ([fold]) => ({
      proposition: `warn: ${fold} repeats in trace (possible training loop)`,
      fold: 'Yax',
      confidence: 0.7,
      advice: { target: 'attention', action: 'raise', value: 0.1 },
    }),
  },
  {
    name: 'low-gravity-gate',
    pattern: '^metric:gravity=([0-9.]+)$',
    transform: ([valStr]) => {
      const g = parseFloat(valStr);
      if (g < 8.0) {
        return {
          proposition: 'warn: gravity gate low; build pressure/attention',
          fold: 'Wo',
          confidence: 0.8,
          advice: { target: 'pressure', action: 'raise', value: 0.05 },
        };
      }
      return null;
    },
  },
];

class SemanticTrainer {
  constructor(opts = {}) {
    this.reasoner = opts.reasoner || new SemanticPatternReasoner({ timeoutMs: opts.timeoutMs ?? 1000 });
    for (const rule of opts.rules || DEFAULT_TRAINING_RULES) {
      this.reasoner.addRule(rule);
    }
    this.memory = this.reasoner.memory;
    this.adviceLog = [];
  }

  // Seed memory with node metadata so rules can inspect gravity etc.
  registerNodes(nodes) {
    for (const n of nodes) {
      this.memory.set(`fold:${n.id}`, n.fold);
      this.memory.set(`lane:${n.id}`, n.lane);
      this.memory.set(`gravity:${n.id}`, n.gravity);
      this.memory.set(`symbol:${n.id}`, n.symbol);
    }
  }

  // Convert a GLSLTrainer skeleton into propositions and reason about it.
  async analyze(trainerOrNodes, metrics = {}) {
    const nodes = Array.isArray(trainerOrNodes) ? trainerOrNodes : (trainerOrNodes.nodes || []);
    this.registerNodes(nodes);
    const propositions = nodes.map(nodeProposition);

    // add metric propositions
    if (metrics.entropy !== undefined) propositions.push(metricProposition('entropy', metrics.entropy));
    if (metrics.gravity !== undefined) propositions.push(metricProposition('gravity', metrics.gravity));
    if (metrics.attention !== undefined) propositions.push(metricProposition('attention', metrics.attention));
    if (metrics.pressure !== undefined) propositions.push(metricProposition('pressure', metrics.pressure));
    if (metrics.affinity !== undefined) propositions.push(metricProposition('affinity', metrics.affinity));

    const conclusions = await this.reasoner.reasonAll(propositions);
    const advice = conclusions.filter(c => c.advice).map(c => c.advice);
    this.adviceLog.push({ timestamp: new Date().toISOString(), conclusions });
    return { conclusions, advice, propositions, stats: this.reasoner.getStats() };
  }

  // Apply semantic advice to a GLSLTrainer step config.
  adjustStep(baseStep, adviceList) {
    let lrScale = 1.0;
    let pressureDelta = 0.0;
    let attentionDelta = 0.0;
    const inserts = [];

    for (const a of adviceList) {
      if (a.target === 'lr' && a.action === 'scale') {
        lrScale *= a.value ?? 1.0;
      } else if (a.target === 'pressure' && a.action === 'raise') {
        pressureDelta += a.value ?? 0.0;
      } else if (a.target === 'attention' && a.action === 'raise') {
        attentionDelta += a.value ?? 0.0;
      } else if (a.target === 'phase' && a.action === 'insert') {
        inserts.push(a.value);
      }
    }

    return {
      ...baseStep,
      lr: (baseStep.lr || 0.05) * lrScale,
      pressureDelta,
      attentionDelta,
      phaseInserts: inserts,
    };
  }

  getAdviceLog() {
    return this.adviceLog;
  }
}

module.exports = { SemanticTrainer, DEFAULT_TRAINING_RULES };
