// KUHUL-ES package entry point
// Exports the canonical Node runtime, browser core, physics engine, trainer,
// thinking engine, pattern reasoner, KXML driver, and chat templates.

const { KUHULRuntimeNode } = require('../runtime/src/node.js');
const { KuhulPhysics } = require('../runtime/src/physics.js');
const { GLSLTrainer, glslHttpTransport } = require('../runtime/src/trainer.js');
const { KuhulThinkEngine, DEFAULT_RULES } = require('../runtime/src/think.js');
const { SemanticPatternReasoner } = require('../runtime/src/pattern_reasoner.js');
const { SemanticTrainer, DEFAULT_TRAINING_RULES } = require('../runtime/src/trainer_semantic.js');
const { RuntimeParser } = require('../runtime/src/runtime_parser.js');
const { ExpressionEvaluator } = require('../runtime/src/expression_evaluator.js');
const { KxmlModel, opEmbed, opLayerNorm, opMatmul, opGelu, opAttention, GLYPH_TO_FOLD } = require('../runtime/src/kxml_driver.js');
const { readStb, readStbFile } = require('../runtime/src/stb_reader.js');
const { toJinja, emitTemplate, renderForGguf, renderJinja } = require('../runtime/src/kxml_chat.js');
const { KUHULRuntimeCore, hashState, DEFAULT_GLYPHS } = require('../runtime/src/core.js');

module.exports = {
  KUHULRuntimeNode,
  KUHULRuntimeCore,
  KuhulPhysics,
  GLSLTrainer,
  glslHttpTransport,
  KuhulThinkEngine,
  SemanticPatternReasoner,
  SemanticTrainer,
  RuntimeParser,
  ExpressionEvaluator,
  KxmlModel,
  opEmbed,
  opLayerNorm,
  opMatmul,
  opGelu,
  opAttention,
  GLYPH_TO_FOLD,
  readStb,
  readStbFile,
  toJinja,
  emitTemplate,
  renderForGguf,
  renderJinja,
  hashState,
  DEFAULT_GLYPHS,
  DEFAULT_TRAINING_RULES,
  DEFAULT_RULES,
};
