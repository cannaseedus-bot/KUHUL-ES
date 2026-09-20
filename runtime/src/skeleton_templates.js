'use strict';

const crypto = require('crypto');

const DEFAULT_MAX_MATERIALIZED_PARAMS = 250000;

const product = (shape = []) => shape.reduce((acc, dim) => acc * Math.max(0, Number(dim) || 0), 1);
const randomArray = (length, scale = 0.5) =>
  Array.from({ length }, () => (Math.random() * 2 - 1) * scale);
const filledArray = (length, value = 0) => Array.from({ length }, () => value);

function buildTensor(shape, opts = {}) {
  const initializer = opts.initializer || 'random';
  const scale = opts.scale ?? 0.5;
  const value = opts.value ?? 0;
  const materializeWeights = opts.materializeWeights !== false;
  const maxMaterializedParams = Number.isFinite(opts.maxMaterializedParams)
    ? opts.maxMaterializedParams
    : DEFAULT_MAX_MATERIALIZED_PARAMS;
  const paramCount = product(shape);
  const materialized = materializeWeights && paramCount <= maxMaterializedParams;

  if (!materialized) {
    return {
      values: null,
      meta: {
        shape: [...shape],
        param_count: paramCount,
        materialized: false,
        initializer,
        reason: materializeWeights ? 'param_budget_exceeded' : 'materialization_disabled',
      },
    };
  }

  let values;
  if (initializer === 'ones') values = filledArray(paramCount, 1);
  else if (initializer === 'zeros') values = filledArray(paramCount, 0);
  else if (initializer === 'constant') values = filledArray(paramCount, value);
  else values = randomArray(paramCount, scale);

  return {
    values,
    meta: {
      shape: [...shape],
      param_count: paramCount,
      materialized: true,
      initializer,
    },
  };
}

function attachTensor(node, field, shape, opts = {}) {
  const t = buildTensor(shape, opts);
  node[field] = t.values;
  node[`${field}_meta`] = t.meta;
  return node;
}

class SkeletonTemplate {
  constructor(config = {}) {
    this.protocol = 'kast/1';
    this.source_kind = config.source_kind || 'glsl-trainer';
    this.nodes = [];
    this.config = config.config || {};
    this.metadata = config.metadata || {};
    this.timestamp = new Date().toISOString();
    this.semantic_hash = '';
    this.materializeWeights = config.materializeWeights !== false;
    this.maxMaterializedParams = Number.isFinite(config.maxMaterializedParams)
      ? config.maxMaterializedParams
      : DEFAULT_MAX_MATERIALIZED_PARAMS;
    this._generateId();
  }

  _tensorOpts(overrides = {}) {
    return {
      materializeWeights: this.materializeWeights,
      maxMaterializedParams: this.maxMaterializedParams,
      ...overrides,
    };
  }

  _generateId() {
    const data = JSON.stringify({
      protocol: this.protocol,
      source_kind: this.source_kind,
      nodes: this.nodes,
      config: this.config,
      metadata: this.metadata,
    });
    this.semantic_hash = crypto.createHash('sha256').update(data).digest('hex');
  }

  addNode(node) {
    this.nodes.push(node);
    this._generateId();
    return this;
  }

  getLayersByFold(fold) {
    return this.nodes.filter((n) => n.fold === fold);
  }

  getInputDim() {
    return this.config.inputDim || 0;
  }

  getHiddenDim() {
    return this.config.hiddenDim || 0;
  }

  getOutputDim() {
    return this.config.outputDim || 0;
  }

  toJSON() {
    this._generateId();
    return {
      protocol: this.protocol,
      source_kind: this.source_kind,
      nodes: this.nodes,
      config: this.config,
      metadata: this.metadata,
      semantic_hash: this.semantic_hash,
      timestamp: this.timestamp,
    };
  }
}

class NeuralNetworkTemplates {
  static createMLP(config = {}) {
    const template = new SkeletonTemplate({
      source_kind: 'glsl-trainer-mlp',
      config: {
        inputDim: config.inputDim || 2,
        hiddenDim: config.hiddenDim || 40,
        outputDim: config.outputDim || 1,
        layers: config.layers || 2,
        activation: config.activation || 'relu',
        source: config.source || 'mlp_trained.json',
      },
      metadata: {
        architecture: 'MLP',
        description: 'Multi-Layer Perceptron',
        version: '1.0.0',
      },
      materializeWeights: config.materializeWeights,
      maxMaterializedParams: config.maxMaterializedParams,
    });

    const { inputDim, hiddenDim, outputDim, layers } = template.config;
    const inNode = {
      id: 'EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'input',
      glyph: 'embed',
      opcode: 'EMBED',
      gravity: 'Embed',
      symbol: 'W_embed',
      shape: [hiddenDim, inputDim],
      activation: 'relu',
    };
    attachTensor(inNode, 'weights', [hiddenDim, inputDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(inNode, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(inNode);

    for (let i = 1; i <= layers; i++) {
      const isLast = i === layers;
      const currentDim = hiddenDim;
      const nextDim = isLast ? outputDim : hiddenDim;
      const node = {
        id: `LAYER${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: isLast ? 'output' : 'hidden',
        glyph: 'Sek',
        opcode: 'DENSE',
        gravity: 'Process',
        symbol: `W_layer${i}`,
        shape: [nextDim, currentDim],
        activation: isLast ? 'linear' : template.config.activation,
      };
      attachTensor(node, 'weights', [nextDim, currentDim], template._tensorOpts({ initializer: 'random' }));
      attachTensor(node, 'bias', [nextDim], template._tensorOpts({ initializer: 'random' }));
      template.addNode(node);
    }

    return template;
  }

  static createCNN(config = {}) {
    const template = new SkeletonTemplate({
      source_kind: 'glsl-trainer-cnn',
      config: {
        inputDim: config.inputDim || 28,
        inputChannels: config.inputChannels || 1,
        hiddenDim: config.hiddenDim || 40,
        outputDim: config.outputDim || 10,
        convLayers: config.convLayers || 2,
        kernelSize: config.kernelSize || 3,
        source: config.source || 'cnn_trained.json',
      },
      metadata: {
        architecture: 'CNN',
        description: 'Convolutional Neural Network',
        version: '1.0.0',
      },
      materializeWeights: config.materializeWeights,
      maxMaterializedParams: config.maxMaterializedParams,
    });

    const { inputDim, inputChannels, hiddenDim, outputDim, convLayers, kernelSize } = template.config;
    const embedNode = {
      id: 'EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'input',
      glyph: 'embed',
      opcode: 'CONV_EMBED',
      gravity: 'Embed',
      symbol: 'W_embed',
      shape: [hiddenDim, inputDim * inputChannels],
      kernel_size: kernelSize,
      stride: 1,
      padding: 0,
    };
    attachTensor(embedNode, 'weights', [hiddenDim, inputDim * inputChannels], template._tensorOpts({ initializer: 'random' }));
    attachTensor(embedNode, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(embedNode);

    for (let i = 1; i <= convLayers; i++) {
      const channels = hiddenDim;
      const node = {
        id: `CONV${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: i === convLayers ? 'features' : 'hidden',
        glyph: 'Sek',
        opcode: 'CONV2D',
        gravity: 'Process',
        symbol: `W_conv${i}`,
        shape: [channels, channels, kernelSize, kernelSize],
        kernel_size: kernelSize,
        stride: 1,
        padding: 0,
        activation: 'relu',
      };
      attachTensor(node, 'weights', [channels, channels, kernelSize, kernelSize], template._tensorOpts({ initializer: 'random' }));
      attachTensor(node, 'bias', [channels], template._tensorOpts({ initializer: 'random' }));
      template.addNode(node);
    }

    const outNode = {
      id: 'OUTPUT',
      kind: 'node',
      fold: 'Sek',
      lane: 'output',
      glyph: 'Sek',
      opcode: 'DENSE',
      gravity: 'Process',
      symbol: 'W_output',
      shape: [outputDim, hiddenDim],
      activation: 'softmax',
    };
    attachTensor(outNode, 'weights', [outputDim, hiddenDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(outNode, 'bias', [outputDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(outNode);

    return template;
  }

  static createRNN(config = {}) {
    const template = new SkeletonTemplate({
      source_kind: 'glsl-trainer-rnn',
      config: {
        inputDim: config.inputDim || 2,
        hiddenDim: config.hiddenDim || 40,
        outputDim: config.outputDim || 1,
        sequenceLength: config.sequenceLength || 10,
        layers: config.layers || 1,
        source: config.source || 'rnn_trained.json',
      },
      metadata: {
        architecture: 'RNN',
        description: 'Recurrent Neural Network',
        version: '1.0.0',
      },
      materializeWeights: config.materializeWeights,
      maxMaterializedParams: config.maxMaterializedParams,
    });

    const { inputDim, hiddenDim, outputDim, sequenceLength, layers } = template.config;
    const embedNode = {
      id: 'EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'input',
      glyph: 'embed',
      opcode: 'RNN_EMBED',
      gravity: 'Embed',
      symbol: 'W_embed',
      shape: [hiddenDim, inputDim],
      sequence_length: sequenceLength,
    };
    attachTensor(embedNode, 'weights', [hiddenDim, inputDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(embedNode, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(embedNode);

    for (let i = 1; i <= layers; i++) {
      const isLast = i === layers;
      const nextDim = isLast ? outputDim : hiddenDim;
      const node = {
        id: `RNN${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: isLast ? 'output' : 'hidden',
        glyph: 'Sek',
        opcode: 'RNN_CELL',
        gravity: 'Process',
        symbol: `W_rnn${i}`,
        shape: [nextDim, hiddenDim * 2],
        activation: 'tanh',
        recurrent: true,
      };
      attachTensor(node, 'weights', [nextDim, hiddenDim * 2], template._tensorOpts({ initializer: 'random' }));
      attachTensor(node, 'bias', [nextDim], template._tensorOpts({ initializer: 'random' }));
      template.addNode(node);
    }
    return template;
  }

  static createLSTM(config = {}) {
    const template = new SkeletonTemplate({
      source_kind: 'glsl-trainer-lstm',
      config: {
        inputDim: config.inputDim || 2,
        hiddenDim: config.hiddenDim || 40,
        outputDim: config.outputDim || 1,
        sequenceLength: config.sequenceLength || 10,
        layers: config.layers || 1,
        source: config.source || 'lstm_trained.json',
      },
      metadata: {
        architecture: 'LSTM',
        description: 'Long Short-Term Memory',
        version: '1.0.0',
      },
      materializeWeights: config.materializeWeights,
      maxMaterializedParams: config.maxMaterializedParams,
    });

    const { inputDim, hiddenDim, outputDim, sequenceLength } = template.config;
    const embedNode = {
      id: 'EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'input',
      glyph: 'embed',
      opcode: 'LSTM_EMBED',
      gravity: 'Embed',
      symbol: 'W_embed',
      shape: [hiddenDim, inputDim],
      sequence_length: sequenceLength,
    };
    attachTensor(embedNode, 'weights', [hiddenDim, inputDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(embedNode, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(embedNode);

    const lstmNode = {
      id: 'LSTM1',
      kind: 'node',
      fold: 'Sek',
      lane: 'hidden',
      glyph: 'Sek',
      opcode: 'LSTM_CELL',
      gravity: 'Process',
      symbol: 'W_lstm',
      shape: [hiddenDim * 4, hiddenDim * 2],
      activation: 'sigmoid',
      recurrent: true,
      gates: ['input', 'forget', 'cell', 'output'],
    };
    attachTensor(lstmNode, 'weights', [hiddenDim * 4, hiddenDim * 2], template._tensorOpts({ initializer: 'random' }));
    attachTensor(lstmNode, 'bias', [hiddenDim * 4], template._tensorOpts({ initializer: 'random' }));
    template.addNode(lstmNode);

    const outNode = {
      id: 'OUTPUT',
      kind: 'node',
      fold: 'Sek',
      lane: 'output',
      glyph: 'Sek',
      opcode: 'DENSE',
      gravity: 'Process',
      symbol: 'W_output',
      shape: [outputDim, hiddenDim],
      activation: 'linear',
    };
    attachTensor(outNode, 'weights', [outputDim, hiddenDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(outNode, 'bias', [outputDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(outNode);

    return template;
  }

  static createTransformer(config = {}) {
    const template = new SkeletonTemplate({
      source_kind: 'glsl-trainer-transformer',
      config: {
        inputDim: config.inputDim || 512,
        hiddenDim: config.hiddenDim || 2048,
        outputDim: config.outputDim || 512,
        numHeads: config.numHeads || 8,
        numLayers: config.numLayers || 6,
        maxSeqLength: config.maxSeqLength || 512,
        source: config.source || 'transformer_trained.json',
      },
      metadata: {
        architecture: 'Transformer',
        description: 'Transformer Neural Network',
        version: '1.0.0',
      },
      materializeWeights: config.materializeWeights,
      maxMaterializedParams: config.maxMaterializedParams,
    });

    const { inputDim, hiddenDim, outputDim, numHeads, numLayers, maxSeqLength } = template.config;
    const embed = {
      id: 'EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'input',
      glyph: 'embed',
      opcode: 'TRANSFORMER_EMBED',
      gravity: 'Embed',
      symbol: 'W_embed',
      shape: [hiddenDim, inputDim],
      max_seq_length: maxSeqLength,
    };
    attachTensor(embed, 'weights', [hiddenDim, inputDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(embed, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(embed);

    const pos = {
      id: 'POS_ENC',
      kind: 'node',
      fold: 'Pop',
      lane: 'positional',
      glyph: 'embed',
      opcode: 'POSITIONAL_ENCODING',
      gravity: 'Encode',
      symbol: 'W_pos',
      shape: [maxSeqLength, hiddenDim],
      max_seq_length: maxSeqLength,
      bias: null,
    };
    attachTensor(pos, 'weights', [maxSeqLength, hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(pos);

    for (let i = 1; i <= numLayers; i++) {
      const attn = {
        id: `ATTENTION${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: 'attention',
        glyph: 'Sek',
        opcode: 'MULTI_HEAD_ATTENTION',
        gravity: 'Process',
        symbol: `W_att${i}`,
        shape: [numHeads, hiddenDim, hiddenDim],
        num_heads: numHeads,
        head_dim: hiddenDim / numHeads,
        bias: null,
      };
      attachTensor(attn, 'weights', [numHeads, hiddenDim, hiddenDim], template._tensorOpts({ initializer: 'random' }));
      template.addNode(attn);

      const ffn = {
        id: `FFN${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: 'ffn',
        glyph: 'Sek',
        opcode: 'FEED_FORWARD',
        gravity: 'Process',
        symbol: `W_ffn${i}`,
        shape: [hiddenDim, hiddenDim * 2],
        activation: 'gelu',
      };
      attachTensor(ffn, 'weights', [hiddenDim, hiddenDim * 2], template._tensorOpts({ initializer: 'random' }));
      attachTensor(ffn, 'bias', [hiddenDim * 2], template._tensorOpts({ initializer: 'random' }));
      template.addNode(ffn);

      const ln = {
        id: `LN${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: 'norm',
        glyph: 'Sek',
        opcode: 'LAYER_NORM',
        gravity: 'Normalize',
        symbol: `W_ln${i}`,
        shape: [hiddenDim],
      };
      attachTensor(ln, 'weights', [hiddenDim], template._tensorOpts({ initializer: 'ones' }));
      attachTensor(ln, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'zeros' }));
      template.addNode(ln);
    }

    const out = {
      id: 'OUTPUT',
      kind: 'node',
      fold: 'Sek',
      lane: 'output',
      glyph: 'Sek',
      opcode: 'DENSE',
      gravity: 'Process',
      symbol: 'W_output',
      shape: [outputDim, hiddenDim],
      activation: 'linear',
    };
    attachTensor(out, 'weights', [outputDim, hiddenDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(out, 'bias', [outputDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(out);

    return template;
  }
}

class DomainSkeletons {
  static createNLP(config = {}) {
    const template = new SkeletonTemplate({
      source_kind: 'glsl-trainer-nlp',
      config: {
        vocabSize: config.vocabSize || 10000,
        embedDim: config.embedDim || 128,
        hiddenDim: config.hiddenDim || 256,
        outputDim: config.outputDim || 100,
        maxSeqLength: config.maxSeqLength || 64,
        source: config.source || 'nlp_trained.json',
      },
      metadata: {
        domain: 'NLP',
        description: 'Natural Language Processing',
        version: '1.0.0',
      },
      materializeWeights: config.materializeWeights,
      maxMaterializedParams: config.maxMaterializedParams,
    });

    const { vocabSize, embedDim, hiddenDim, outputDim, maxSeqLength } = template.config;
    const w = {
      id: 'WORD_EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'embedding',
      glyph: 'embed',
      opcode: 'WORD_EMBED',
      gravity: 'Embed',
      symbol: 'W_embed',
      shape: [embedDim, vocabSize],
      vocab_size: vocabSize,
      embed_dim: embedDim,
      bias: null,
    };
    attachTensor(w, 'weights', [embedDim, vocabSize], template._tensorOpts({ initializer: 'random' }));
    template.addNode(w);

    const pos = {
      id: 'POS_EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'positional',
      glyph: 'embed',
      opcode: 'POSITIONAL_EMBED',
      gravity: 'Embed',
      symbol: 'W_pos',
      shape: [maxSeqLength, embedDim],
      max_seq_length: maxSeqLength,
      bias: null,
    };
    attachTensor(pos, 'weights', [maxSeqLength, embedDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(pos);

    const bilstm = {
      id: 'BILSTM1',
      kind: 'node',
      fold: 'Sek',
      lane: 'encoding',
      glyph: 'Sek',
      opcode: 'BILSTM',
      gravity: 'Process',
      symbol: 'W_bilstm',
      shape: [hiddenDim * 2, embedDim * 2],
      bidirectional: true,
      activation: 'tanh',
    };
    attachTensor(bilstm, 'weights', [hiddenDim * 2, embedDim * 2], template._tensorOpts({ initializer: 'random' }));
    attachTensor(bilstm, 'bias', [hiddenDim * 2], template._tensorOpts({ initializer: 'random' }));
    template.addNode(bilstm);

    const attn = {
      id: 'ATTENTION',
      kind: 'node',
      fold: 'Sek',
      lane: 'attention',
      glyph: 'Sek',
      opcode: 'ATTENTION',
      gravity: 'Process',
      symbol: 'W_att',
      shape: [hiddenDim * 2, hiddenDim * 2],
      bias: null,
    };
    attachTensor(attn, 'weights', [hiddenDim * 2, hiddenDim * 2], template._tensorOpts({ initializer: 'random' }));
    template.addNode(attn);

    const out = {
      id: 'OUTPUT',
      kind: 'node',
      fold: 'Sek',
      lane: 'output',
      glyph: 'Sek',
      opcode: 'DENSE',
      gravity: 'Process',
      symbol: 'W_output',
      shape: [outputDim, hiddenDim * 2],
      activation: 'softmax',
    };
    attachTensor(out, 'weights', [outputDim, hiddenDim * 2], template._tensorOpts({ initializer: 'random' }));
    attachTensor(out, 'bias', [outputDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(out);
    return template;
  }

  static createVision(config = {}) {
    const template = new SkeletonTemplate({
      source_kind: 'glsl-trainer-vision',
      config: {
        inputWidth: config.inputWidth || 224,
        inputHeight: config.inputHeight || 224,
        inputChannels: config.inputChannels || 3,
        hiddenDim: config.hiddenDim || 512,
        outputDim: config.outputDim || 1000,
        source: config.source || 'vision_trained.json',
      },
      metadata: {
        domain: 'Vision',
        description: 'Computer Vision',
        version: '1.0.0',
      },
      materializeWeights: config.materializeWeights,
      maxMaterializedParams: config.maxMaterializedParams,
    });

    const { inputWidth, inputHeight, inputChannels, hiddenDim, outputDim } = template.config;
    const embed = {
      id: 'EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'input',
      glyph: 'embed',
      opcode: 'VISION_EMBED',
      gravity: 'Embed',
      symbol: 'W_embed',
      shape: [hiddenDim, inputWidth * inputHeight * inputChannels],
      input_width: inputWidth,
      input_height: inputHeight,
      input_channels: inputChannels,
    };
    attachTensor(embed, 'weights', [hiddenDim, inputWidth * inputHeight * inputChannels], template._tensorOpts({ initializer: 'random' }));
    attachTensor(embed, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(embed);

    for (let i = 1; i <= 4; i++) {
      const channels = i === 1 ? hiddenDim : Math.max(8, Math.floor(hiddenDim / Math.pow(2, i - 2)));
      const nextChannels = i < 4 ? Math.max(8, Math.floor(hiddenDim / Math.pow(2, i - 1))) : Math.max(8, Math.floor(hiddenDim / 4));
      const conv = {
        id: `RES_CONV${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: 'convolution',
        glyph: 'Sek',
        opcode: 'CONV2D',
        gravity: 'Process',
        symbol: `W_res${i}`,
        shape: [nextChannels, channels, 3, 3],
        kernel_size: 3,
        stride: i === 1 ? 1 : 2,
        padding: 1,
        activation: 'relu',
      };
      attachTensor(conv, 'weights', [nextChannels, channels, 3, 3], template._tensorOpts({ initializer: 'random' }));
      attachTensor(conv, 'bias', [nextChannels], template._tensorOpts({ initializer: 'random' }));
      template.addNode(conv);

      const bn = {
        id: `BN${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: 'normalization',
        glyph: 'Sek',
        opcode: 'BATCH_NORM',
        gravity: 'Normalize',
        symbol: `W_bn${i}`,
        shape: [nextChannels],
      };
      attachTensor(bn, 'weights', [nextChannels], template._tensorOpts({ initializer: 'ones' }));
      attachTensor(bn, 'bias', [nextChannels], template._tensorOpts({ initializer: 'zeros' }));
      template.addNode(bn);
    }

    template.addNode({
      id: 'POOL',
      kind: 'node',
      fold: 'Sek',
      lane: 'pooling',
      glyph: 'Sek',
      opcode: 'GLOBAL_POOL',
      gravity: 'Pool',
      symbol: 'W_pool',
      shape: [Math.max(8, Math.floor(hiddenDim / 4))],
      weights: null,
      bias: null,
      pool_type: 'avg',
    });

    const out = {
      id: 'OUTPUT',
      kind: 'node',
      fold: 'Sek',
      lane: 'output',
      glyph: 'Sek',
      opcode: 'DENSE',
      gravity: 'Process',
      symbol: 'W_output',
      shape: [outputDim, Math.max(8, Math.floor(hiddenDim / 4))],
      activation: 'softmax',
    };
    attachTensor(out, 'weights', [outputDim, Math.max(8, Math.floor(hiddenDim / 4))], template._tensorOpts({ initializer: 'random' }));
    attachTensor(out, 'bias', [outputDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(out);

    return template;
  }

  static createAudio(config = {}) {
    const template = new SkeletonTemplate({
      source_kind: 'glsl-trainer-audio',
      config: {
        inputLength: config.inputLength || 16000,
        melBands: config.melBands || 80,
        hiddenDim: config.hiddenDim || 128,
        outputDim: config.outputDim || 10,
        source: config.source || 'audio_trained.json',
      },
      metadata: {
        domain: 'Audio',
        description: 'Audio Processing',
        version: '1.0.0',
      },
      materializeWeights: config.materializeWeights,
      maxMaterializedParams: config.maxMaterializedParams,
    });

    const { inputLength, melBands, hiddenDim, outputDim } = template.config;
    const embed = {
      id: 'EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'input',
      glyph: 'embed',
      opcode: 'AUDIO_EMBED',
      gravity: 'Embed',
      symbol: 'W_embed',
      shape: [hiddenDim, melBands],
      mel_bands: melBands,
      input_length: inputLength,
    };
    attachTensor(embed, 'weights', [hiddenDim, melBands], template._tensorOpts({ initializer: 'random' }));
    attachTensor(embed, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(embed);

    for (let i = 1; i <= 3; i++) {
      const channels = i === 1 ? 64 : 128;
      const conv = {
        id: `AUDIO_CONV${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: 'convolution',
        glyph: 'Sek',
        opcode: 'CONV1D',
        gravity: 'Process',
        symbol: `W_aconv${i}`,
        shape: [channels, hiddenDim, 3],
        kernel_size: 3,
        stride: 2,
        activation: 'relu',
      };
      attachTensor(conv, 'weights', [channels, hiddenDim, 3], template._tensorOpts({ initializer: 'random' }));
      attachTensor(conv, 'bias', [channels], template._tensorOpts({ initializer: 'random' }));
      template.addNode(conv);
    }

    const gru = {
      id: 'GRU',
      kind: 'node',
      fold: 'Sek',
      lane: 'recurrent',
      glyph: 'Sek',
      opcode: 'GRU',
      gravity: 'Process',
      symbol: 'W_gru',
      shape: [hiddenDim, hiddenDim * 2],
      bidirectional: true,
      activation: 'tanh',
    };
    attachTensor(gru, 'weights', [hiddenDim, hiddenDim * 2], template._tensorOpts({ initializer: 'random' }));
    attachTensor(gru, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(gru);

    const out = {
      id: 'OUTPUT',
      kind: 'node',
      fold: 'Sek',
      lane: 'output',
      glyph: 'Sek',
      opcode: 'DENSE',
      gravity: 'Process',
      symbol: 'W_output',
      shape: [outputDim, hiddenDim * 2],
      activation: 'softmax',
    };
    attachTensor(out, 'weights', [outputDim, hiddenDim * 2], template._tensorOpts({ initializer: 'random' }));
    attachTensor(out, 'bias', [outputDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(out);

    return template;
  }

  static createGNN(config = {}) {
    const template = new SkeletonTemplate({
      source_kind: 'glsl-trainer-gnn',
      config: {
        nodeDim: config.nodeDim || 64,
        edgeDim: config.edgeDim || 32,
        hiddenDim: config.hiddenDim || 128,
        outputDim: config.outputDim || 1,
        numLayers: config.numLayers || 3,
        source: config.source || 'gnn_trained.json',
      },
      metadata: {
        domain: 'GNN',
        description: 'Graph Neural Network',
        version: '1.0.0',
      },
      materializeWeights: config.materializeWeights,
      maxMaterializedParams: config.maxMaterializedParams,
    });

    const { nodeDim, edgeDim, hiddenDim, outputDim, numLayers } = template.config;
    const nodeEmbed = {
      id: 'NODE_EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'nodes',
      glyph: 'embed',
      opcode: 'NODE_EMBED',
      gravity: 'Embed',
      symbol: 'W_node',
      shape: [hiddenDim, nodeDim],
      node_dim: nodeDim,
    };
    attachTensor(nodeEmbed, 'weights', [hiddenDim, nodeDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(nodeEmbed, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(nodeEmbed);

    const edgeEmbed = {
      id: 'EDGE_EMBED',
      kind: 'node',
      fold: 'Pop',
      lane: 'edges',
      glyph: 'embed',
      opcode: 'EDGE_EMBED',
      gravity: 'Embed',
      symbol: 'W_edge',
      shape: [hiddenDim, edgeDim],
      edge_dim: edgeDim,
    };
    attachTensor(edgeEmbed, 'weights', [hiddenDim, edgeDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(edgeEmbed, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(edgeEmbed);

    for (let i = 1; i <= numLayers; i++) {
      const gconv = {
        id: `GCONV${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: 'convolution',
        glyph: 'Sek',
        opcode: 'GRAPH_CONV',
        gravity: 'Process',
        symbol: `W_gconv${i}`,
        shape: [hiddenDim, hiddenDim],
        activation: 'relu',
      };
      attachTensor(gconv, 'weights', [hiddenDim, hiddenDim], template._tensorOpts({ initializer: 'random' }));
      attachTensor(gconv, 'bias', [hiddenDim], template._tensorOpts({ initializer: 'random' }));
      template.addNode(gconv);

      const gatt = {
        id: `GATT${i}`,
        kind: 'node',
        fold: 'Sek',
        lane: 'attention',
        glyph: 'Sek',
        opcode: 'GRAPH_ATTENTION',
        gravity: 'Process',
        symbol: `W_gatt${i}`,
        shape: [hiddenDim, hiddenDim],
        num_heads: 4,
        bias: null,
      };
      attachTensor(gatt, 'weights', [hiddenDim, hiddenDim], template._tensorOpts({ initializer: 'random' }));
      template.addNode(gatt);
    }

    template.addNode({
      id: 'GLOBAL_POOL',
      kind: 'node',
      fold: 'Sek',
      lane: 'pooling',
      glyph: 'Sek',
      opcode: 'GLOBAL_POOL',
      gravity: 'Pool',
      symbol: 'W_gpool',
      shape: [hiddenDim],
      weights: null,
      bias: null,
      pool_type: 'sum',
    });

    const out = {
      id: 'OUTPUT',
      kind: 'node',
      fold: 'Sek',
      lane: 'output',
      glyph: 'Sek',
      opcode: 'DENSE',
      gravity: 'Process',
      symbol: 'W_output',
      shape: [outputDim, hiddenDim],
      activation: 'sigmoid',
    };
    attachTensor(out, 'weights', [outputDim, hiddenDim], template._tensorOpts({ initializer: 'random' }));
    attachTensor(out, 'bias', [outputDim], template._tensorOpts({ initializer: 'random' }));
    template.addNode(out);
    return template;
  }
}

class SkeletonFactory {
  static create(type, config = {}) {
    const lookup = {
      mlp: NeuralNetworkTemplates.createMLP,
      cnn: NeuralNetworkTemplates.createCNN,
      rnn: NeuralNetworkTemplates.createRNN,
      lstm: NeuralNetworkTemplates.createLSTM,
      transformer: NeuralNetworkTemplates.createTransformer,

      nlp: DomainSkeletons.createNLP,
      vision: DomainSkeletons.createVision,
      audio: DomainSkeletons.createAudio,
      gnn: DomainSkeletons.createGNN,

      nn: NeuralNetworkTemplates.createMLP,
      neural: NeuralNetworkTemplates.createMLP,
      perceptron: NeuralNetworkTemplates.createMLP,
      'multi-layer': NeuralNetworkTemplates.createMLP,
      convolutional: NeuralNetworkTemplates.createCNN,
      recurrent: NeuralNetworkTemplates.createRNN,
      'long-short-term': NeuralNetworkTemplates.createLSTM,
      attention: NeuralNetworkTemplates.createTransformer,
      'natural-language': DomainSkeletons.createNLP,
      'computer-vision': DomainSkeletons.createVision,
      'audio-processing': DomainSkeletons.createAudio,
      graph: DomainSkeletons.createGNN,
    };

    const key = String(type || '').toLowerCase();
    const creator = lookup[key];
    if (!creator) {
      throw new Error(`Unknown skeleton type: ${type}`);
    }
    return creator(config);
  }

  static listTypes() {
    return {
      neural_networks: ['mlp', 'cnn', 'rnn', 'lstm', 'transformer'],
      domains: ['nlp', 'vision', 'audio', 'gnn'],
      aliases: [
        'nn',
        'neural',
        'perceptron',
        'multi-layer',
        'convolutional',
        'recurrent',
        'long-short-term',
        'attention',
        'natural-language',
        'computer-vision',
        'audio-processing',
        'graph',
      ],
    };
  }
}

module.exports = {
  SkeletonTemplate,
  NeuralNetworkTemplates,
  DomainSkeletons,
  SkeletonFactory,

  createMLP: (config) => NeuralNetworkTemplates.createMLP(config),
  createCNN: (config) => NeuralNetworkTemplates.createCNN(config),
  createRNN: (config) => NeuralNetworkTemplates.createRNN(config),
  createLSTM: (config) => NeuralNetworkTemplates.createLSTM(config),
  createTransformer: (config) => NeuralNetworkTemplates.createTransformer(config),
  createNLP: (config) => DomainSkeletons.createNLP(config),
  createVision: (config) => DomainSkeletons.createVision(config),
  createAudio: (config) => DomainSkeletons.createAudio(config),
  createGNN: (config) => DomainSkeletons.createGNN(config),
};
