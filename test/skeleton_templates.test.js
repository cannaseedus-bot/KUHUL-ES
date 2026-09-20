'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  SkeletonFactory,
  NeuralNetworkTemplates,
  DomainSkeletons,
} = require('../runtime/src/skeleton_templates.js');

describe('skeleton templates', () => {
  it('creates an MLP skeleton with expected fold layout', () => {
    const tpl = NeuralNetworkTemplates.createMLP({
      inputDim: 3,
      hiddenDim: 8,
      outputDim: 2,
      layers: 2,
    }).toJSON();

    assert.equal(tpl.protocol, 'kast/1');
    assert.ok(tpl.semantic_hash);
    assert.ok(tpl.nodes.some((n) => n.id === 'EMBED' && n.fold === 'Pop'));
    assert.ok(tpl.nodes.some((n) => n.id === 'LAYER1' && n.fold === 'Sek'));
    assert.ok(tpl.nodes.some((n) => n.id === 'LAYER2' && n.fold === 'Sek'));
  });

  it('supports transformer creation through factory aliases', () => {
    const tpl = SkeletonFactory.create('attention', {
      inputDim: 16,
      hiddenDim: 32,
      outputDim: 8,
      numHeads: 4,
      numLayers: 2,
      materializeWeights: false,
    }).toJSON();

    assert.ok(tpl.nodes.some((n) => n.id === 'ATTENTION1'));
    assert.ok(tpl.nodes.some((n) => n.id === 'ATTENTION2'));
    assert.ok(tpl.nodes.some((n) => n.id === 'FFN1'));
    assert.ok(tpl.nodes.some((n) => n.id === 'LN2'));
    assert.equal(tpl.nodes.find((n) => n.id === 'ATTENTION1').weights, null);
    assert.equal(tpl.nodes.find((n) => n.id === 'ATTENTION1').weights_meta.materialized, false);
  });

  it('deferred-materializes oversized vision tensors by default', () => {
    const tpl = DomainSkeletons.createVision().toJSON();
    const embed = tpl.nodes.find((n) => n.id === 'EMBED');
    assert.ok(embed);
    assert.equal(embed.weights, null);
    assert.equal(embed.weights_meta.materialized, false);
    assert.equal(embed.weights_meta.reason, 'param_budget_exceeded');
  });

  it('lists supported template groups', () => {
    const groups = SkeletonFactory.listTypes();
    assert.ok(groups.neural_networks.includes('mlp'));
    assert.ok(groups.domains.includes('vision'));
    assert.ok(groups.aliases.includes('attention'));
  });
});
