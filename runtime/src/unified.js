'use strict';

const { EventEmitter } = require('events');

// Re-use the existing scxq2 compressor so compression law matches.
const { compress, decompress } = require('./scxq2.js');

const PHASES = ['Pop', 'Wo', 'Yax', 'Sek', "Ch'en", 'Xul', 'Noj'];
const EDGE_KINDS = ['control', 'data', 'sequence', 'admission', 'semantic'];
const EXPANSION_SPACES = ['metaphor', 'analogy', 'framing', 'discipline', 'perspective', 'caveat', 'philosophy'];

class KuhulConfig {
  constructor(opts = {}) {
    this.mode = opts.mode || 'full'; // orchestrate | enforce | expand | full
    this.strict = opts.strict !== false;
    this.debug = opts.debug || false;
    this.compression = opts.compression !== false;
    this.maxSteps = opts.maxSteps || 10000;
    this.timeout = opts.timeout || 30000;
  }
}

// ================================================================
// KAST ENGINE
// ================================================================
class KastEngine {
  constructor(ast) {
    this.ast = ast;
    this.nodes = new Map();
    this.edges = new Map();
    this.context = new Map();
    this._buildIndex();
  }

  _buildIndex() {
    if (this.ast.nodes) {
      for (const node of this.ast.nodes) {
        this.nodes.set(node.id, node);
      }
    }
    if (this.ast.edges) {
      for (const edge of this.ast.edges) {
        const key = `${edge.from}->${edge.to}`;
        this.edges.set(key, edge);
      }
    }
    if (this.ast.manifest) {
      for (const [key, value] of Object.entries(this.ast.manifest)) {
        this.context.set(key, value);
      }
    }
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  getEdge(from, to) {
    return this.edges.get(`${from}->${to}`);
  }

  getOutgoing(id) {
    const result = [];
    for (const edge of this.edges.values()) {
      if (edge.from === id) result.push(edge);
    }
    return result;
  }

  getIncoming(id) {
    const result = [];
    for (const edge of this.edges.values()) {
      if (edge.to === id) result.push(edge);
    }
    return result;
  }

  getPhaseNodes(phase) {
    const result = [];
    for (const node of this.nodes.values()) {
      if (node.phase === phase) result.push(node);
    }
    return result;
  }

  validate() {
    for (const [id, node] of this.nodes) {
      if (!PHASES.includes(node.phase)) {
        throw new Error(`Invalid phase ${node.phase} in node ${id}`);
      }
    }
    for (const [key, edge] of this.edges) {
      if (!EDGE_KINDS.includes(edge.kind)) {
        throw new Error(`Invalid edge kind ${edge.kind} in edge ${key}`);
      }
    }
    return true;
  }
}

// ================================================================
// KXML ENGINE
// ================================================================
class KxmlEngine {
  constructor(model) {
    this.model = model;
    this.layers = new Map();
    this._buildLayers();
  }

  _buildLayers() {
    if (this.model.forward) {
      for (const layer of this.model.forward) {
        this.layers.set(layer.id, layer);
      }
    }
  }

  async execute(input, opts = {}) {
    const results = new Map();
    const executed = new Set();
    const pending = Array.from(this.layers.values());
    const current = { ...input };

    // DAG execution: keep attempting layers until all are done or stuck.
    while (executed.size < pending.length) {
      let progressed = false;
      for (const layer of pending) {
        if (executed.has(layer.id)) continue;
        if (this._isReady(layer, results, current)) {
          const result = await this._executeLayer(layer, results, current);
          results.set(layer.id, result);
          if (layer.outputs) {
            for (const out of layer.outputs) {
              const outId = typeof out === 'string' ? out : out.id;
              results.set(outId, result);
            }
          }
          executed.add(layer.id);
          progressed = true;
        }
      }
      if (!progressed) {
        const stuck = pending.filter((l) => !executed.has(l.id)).map((l) => l.id);
        throw new Error(`KXML DAG stuck waiting for inputs: ${stuck.join(', ')}`);
      }
    }

    return this._aggregateOutput(results, opts);
  }

  _isReady(layer, results, current) {
    if (!layer.inputs || layer.inputs.length === 0) return true;
    for (const input of layer.inputs) {
      const id = typeof input === 'string' ? input : input.id;
      if (!results.has(id) && !(id in current)) return false;
    }
    return true;
  }

  async _executeLayer(layer, results, current) {
    const op = layer.op || 'identity';
    const inputs = this._gatherInputs(layer, results, current);
    switch (op) {
      case 'embed':
        return this._opEmbed(inputs, layer.params);
      case 'retrieve':
        return this._opRetrieve(inputs, layer.params);
      case 'transform':
        return this._opTransform(inputs, layer.params);
      case 'classify':
        return this._opClassify(inputs, layer.params);
      case 'generate':
        return this._opGenerate(inputs, layer.params);
      case 'tool':
        return this._opTool(inputs, layer.params);
      default:
        return inputs;
    }
  }

  _gatherInputs(layer, results, current) {
    if (!layer.inputs || layer.inputs.length === 0) return { current };
    const inputs = {};
    for (const input of layer.inputs) {
      const id = typeof input === 'string' ? input : input.id;
      inputs[id] = results.get(id) || current;
    }
    return inputs;
  }

  _aggregateOutput(results) {
    const output = {};
    for (const [id, value] of results) {
      output[id] = value;
    }
    return output;
  }

  _opEmbed(inputs, params) {
    const text = inputs.query || inputs.text || inputs.current || '';
    const model = params.model || 'default';
    return {
      embedding: `[embedding_${model}_${String(text).length}]`,
      tokens: String(text).split(/\s+/).filter(Boolean).length,
      model,
    };
  }

  _opRetrieve(inputs, params) {
    const query = inputs.query || inputs.query_text || inputs.current || '';
    const topK = params.topK || 5;
    const corpus = params.corpus || [];
    return {
      documents: corpus.slice(0, topK),
      query,
      scores: corpus.slice(0, topK).map(() => 0.5 + Math.random() * 0.5),
    };
  }

  _opTransform(inputs, params) {
    const data = inputs.data || inputs.current || {};
    const transform = params.transform;
    if (typeof transform === 'function') return transform(data);
    if (transform === 'stringify') return JSON.stringify(data);
    if (transform === 'keys') return Object.keys(data);
    return data;
  }

  _opClassify(inputs, params) {
    const text = inputs.query || inputs.text || inputs.current || '';
    const classes = params.classes || ['positive', 'negative'];
    return {
      label: classes[Math.floor(Math.random() * classes.length)],
      confidence: 0.5 + Math.random() * 0.5,
      text,
    };
  }

  _opGenerate(inputs, params) {
    const prompt = inputs.prompt || inputs.query || inputs.current || '';
    const template = params.template || '{{ input }}';
    const rendered = this._renderTemplate(template, { input: prompt, ...inputs });
    return {
      output: `${rendered}_generated`,
      tokens: rendered.split(/\s+/).filter(Boolean).length,
      model: params.model || 'default',
    };
  }

  async _opTool(inputs, params) {
    const tool = params.tool || 'default';
    const args = inputs.args || inputs.current || {};
    return this._callTool(tool, args);
  }

  async _callTool(name, args) {
    const handlers = this._builtInTools();
    if (handlers[name]) {
      return handlers[name](args);
    }
    return { error: `Unknown tool: ${name}` };
  }

  _builtInTools() {
    const tools = {};
    if (typeof require !== 'undefined') {
      const fs = require('fs');
      tools.read = (args) => {
        if (!args || !args.path) return { error: 'read requires path' };
        return { content: fs.readFileSync(args.path, 'utf8') };
      };
      tools.write = (args) => {
        if (!args || !args.path) return { error: 'write requires path and content' };
        fs.writeFileSync(args.path, args.content);
        return { success: true };
      };
    }
    tools.search = (args) => ({ results: [`Result for ${(args && args.query) || ''}`] });
    tools.compute = (args) => {
      const expr = (args && args.expression) || '0';
      // SECURITY: only allow safe arithmetic expressions.
      const safe = /^[\d\s+\-*/().\s]+$/.test(expr);
      if (!safe) return { error: 'unsafe expression' };
      try {
        // eslint-disable-next-line no-new-func
        return { result: new Function(`return (${expr})`)() };
      } catch {
        return { error: 'computation failed' };
      }
    };
    return tools;
  }

  _renderTemplate(template, context) {
    let output = String(template);
    for (const [key, value] of Object.entries(context)) {
      output = output.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), String(value));
    }
    return output;
  }
}

// ================================================================
// K'UHUL RUNTIME
// ================================================================
class KuhulRuntime extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = new KuhulConfig(config);
    this.kast = null;
    this.kxml = null;
    this.state = new Map();
    this.history = [];
    this.phases = new Map();
    this._initPhases();
  }

  _initPhases() {
    this.phases.set('Pop', this._phasePop.bind(this));
    this.phases.set('Wo', this._phaseWo.bind(this));
    this.phases.set('Yax', this._phaseYax.bind(this));
    this.phases.set('Sek', this._phaseSek.bind(this));
    this.phases.set("Ch'en", this._phaseChen.bind(this));
    this.phases.set('Xul', this._phaseXul.bind(this));
    this.phases.set('Noj', this._phaseNoj.bind(this));
  }

  loadKast(ast) {
    this.kast = new KastEngine(ast);
    this.kast.validate();
    this.emit('kast-loaded', ast);
    return this;
  }

  loadKxml(model) {
    this.kxml = new KxmlEngine(model);
    this.emit('kxml-loaded', model);
    return this;
  }

  loadSource(source) {
    const parsed = this._parseSource(source);
    if (parsed.kast) this.loadKast(parsed.kast);
    if (parsed.kxml) this.loadKxml(parsed.kxml);
    return this;
  }

  async execute(program, opts = {}) {
    const startTime = Date.now();
    const context = this._prepareContext(opts);

    try {
      if (this.config.mode === 'orchestrate') {
        const orchestrated = await this._orchestrate(program, context);
        return await this._enforce(orchestrated, context);
      }
      if (this.config.mode === 'enforce') {
        return await this._enforce(program, context);
      }
      if (this.config.mode === 'expand') {
        return await this._expand(program, context);
      }
      return await this._fullPipeline(program, context);
    } catch (error) {
      this.emit('error', error);
      throw error;
    } finally {
      this.emit('execution-complete', {
        duration: Date.now() - startTime,
        steps: this.history.length,
      });
    }
  }

  // Unified shorthand matching the grammar example:
  // kuhul.execute(source, { orchestrate, enforce, expand })
  async executeUnified(source, controls = {}) {
    const mode = controls.mode || (controls.orchestrate ? 'orchestrate' : controls.enforce ? 'enforce' : controls.expand ? 'expand' : 'full');
    const runtime = new KuhulRuntime({ ...this.config, mode });
    runtime.state = new Map(this.state);
    runtime.loadSource(source);
    return runtime.execute({}, controls);
  }

  async _fullPipeline(program, context) {
    let state = program;

    for (const phase of PHASES) {
      const handler = this.phases.get(phase);
      if (handler) {
        state = await handler(state);
        this.history.push({ phase, state, timestamp: Date.now() });
        this.emit('phase-complete', { phase, state });
      }
    }

    if (this.kxml) {
      state = await this.kxml.execute({ ...program, ...state }, context);
      this.emit('kxml-executed', state);
    }

    if (this.kast) {
      const valid = this.kast.validate();
      if (!valid && this.config.strict) {
        throw new Error('KAST validation failed');
      }
      this.emit('kast-validated', valid);
    }

    if (this.config.compression) {
      const packet = compress(state);
      this.state.set('last_compression', packet);
      this.emit('compressed', packet);
      state = { ...state, _compressed: packet, _compressionValid: this._validateCompression(state, packet) };
    }

    return state;
  }

  _validateCompression(original, packet) {
    try {
      const restored = decompress(packet);
      return JSON.stringify(restored) === JSON.stringify(original);
    } catch {
      return false;
    }
  }

  async _phasePop(input) {
    this.emit('phase-pop', input);
    return { perceived: input, timestamp: Date.now(), type: typeof input };
  }

  async _phaseWo(input) {
    this.emit('phase-wo', input);
    return { represented: input, structure: this._buildStructure(input), metadata: { phase: 'Wo' } };
  }

  async _phaseYax(input) {
    this.emit('phase-yax', input);
    const plan = this._createPlan(input);
    return { plan, steps: plan.length, estimatedCost: plan.length * 0.1 };
  }

  async _phaseSek(input) {
    this.emit('phase-sek', input);
    const result = await this._executePlan(input);
    return { executed: result, duration: Date.now() - (input.timestamp || 0), success: true };
  }

  async _phaseChen(input) {
    this.emit('phase-chen', input);
    return { projected: input, format: 'kxml', confidence: 0.95 };
  }

  async _phaseXul(input) {
    this.emit('phase-xul', input);
    const packet = compress(input);
    return { consolidated: packet, hash: this._hash(input), size: JSON.stringify(input).length };
  }

  async _phaseNoj(input) {
    this.emit('phase-noj', input);
    return { reflected: input, analysis: this._analyze(input), validated: this._validateState(input) };
  }

  async _orchestrate(program, context) {
    this.emit('orchestrating', { program, context });
    return {
      field: this._selectField(program),
      timing: this._arrangeTiming(program),
      strategy: this._chooseStrategy(program),
      reality: this._manageReality(program),
      program,
    };
  }

  async _enforce(program, context) {
    this.emit('enforcing', { program, context });
    const definition = this._defineExecution(program);
    const invariant = this._enforceInvariant(definition);
    this._rejectIllegal(invariant);
    const collapsed = this._collapseToLaw(invariant);
    return { ...program, ...collapsed };
  }

  async _expand(program, context) {
    this.emit('expanding', { program, context });
    const expansions = [];
    for (const space of EXPANSION_SPACES) {
      expansions.push(await this._expandInSpace(program, space));
    }
    return {
      original: program,
      expansions,
      invariant: "'read_only_collapse_result'",
      constrained: "'finite_execution_enforced'",
    };
  }

  _prepareContext(opts) {
    return { ...opts, timestamp: Date.now(), sessionId: this._generateId(), config: this.config };
  }

  _parseSource(source) {
    const parsed = { kast: null, kxml: null };
    if (typeof source !== 'string') {
      if (source.forward) parsed.kxml = source;
      if (source.nodes || source.protocol === 'kast/1') parsed.kast = source;
      return parsed;
    }
    try {
      const json = JSON.parse(source);
      if (json.kind === 'kxml/model' || json.forward) parsed.kxml = json;
      if (json.protocol === 'kast/1' || json.nodes) parsed.kast = json;
    } catch {
      parsed.kast = this._parseKuhulSource(source);
    }
    return parsed;
  }

  _parseKuhulSource(source) {
    const lines = source.split(/\r?\n/);
    const nodes = [];
    const edges = [];
    let nodeId = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const m = trimmed.match(/^\[(\w+)\s+(.*)\]$/);
      if (m) {
        const phase = m[1];
        const rest = m[2];
        const args = rest.split(/\s*→\s*/).map((s) => s.trim());
        const id = `n${++nodeId}`;
        nodes.push({ id, phase, opcode: 'EXECUTE', symbol: args[0] || '', value: args[1] || '' });
        if (nodeId > 1) {
          edges.push({ from: `n${nodeId - 1}`, to: id, kind: 'sequence' });
        }
      }
    }

    return {
      protocol: 'kast/1',
      version: '1.6.0',
      source: 'unified.parse',
      nodes,
      edges,
      phases: PHASES,
    };
  }

  _buildStructure(input) {
    if (typeof input === 'object' && input !== null) return Object.keys(input);
    return typeof input;
  }

  _createPlan(input) {
    if (input && Array.isArray(input.steps)) return input.steps;
    if (input && Array.isArray(input.schedule)) return input.schedule;
    return ['prepare', 'process', 'finalize'];
  }

  async _executePlan(input) {
    const plan = this._createPlan(input);
    const results = [];
    for (const item of plan) {
      results.push(await this._executeItem(item));
    }
    return results;
  }

  async _executeItem(item) {
    if (typeof item === 'function') return item();
    return item;
  }

  _hash(input) {
    const str = JSON.stringify(input);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  _analyze(input) {
    return {
      type: typeof input,
      isArray: Array.isArray(input),
      isObject: typeof input === 'object' && input !== null,
      size: JSON.stringify(input).length,
      complexity: this._calculateComplexity(input),
    };
  }

  _calculateComplexity(input) {
    if (typeof input !== 'object' || input === null) return 1;
    if (Array.isArray(input)) return input.reduce((sum, item) => sum + this._calculateComplexity(item), 0);
    return Object.values(input).reduce((sum, val) => sum + this._calculateComplexity(val), 0);
  }

  _validateState(input) {
    try {
      const packet = compress(input);
      const restored = decompress(packet);
      return {
        valid: JSON.stringify(restored) === JSON.stringify(input),
        compressed: true,
      };
    } catch {
      return { valid: false, compressed: false };
    }
  }

  _selectField(program) {
    return program.field || program.type || program.select || 'default';
  }

  _arrangeTiming(program) {
    return { strategy: 'sequential', priority: program.priority || 1, batch: false };
  }

  _chooseStrategy(program) {
    return { name: this._selectField(program) === 'default' ? 'standard' : 'custom', parameters: program.parameters || {} };
  }

  _manageReality(strategy) {
    return { enabled: true, context: {}, boundaries: ['compression', 'enforcement'] };
  }

  _defineExecution(program) {
    return { definition: program, type: 'executable', timestamp: Date.now() };
  }

  _enforceInvariant(definition) {
    if (!definition.definition) throw new Error('No definition to enforce');
    return { ...definition, enforced: true, invariant: "'collapse_only'" };
  }

  _rejectIllegal(state) {
    if (this.config.strict && state.type === 'illegal') {
      throw new Error('Illegal state detected');
    }
    return state;
  }

  _collapseToLaw(state) {
    return { ...state, collapsed: true, law: JSON.stringify(state), hash: this._hash(state) };
  }

  async _expandInSpace(program, space) {
    const strategy = (p) => `${p} [${space}]`;
    return {
      space,
      expanded: strategy(program),
      invariant: "'non_authoritative_output'",
      timestamp: Date.now(),
    };
  }

  _generateId() {
    return Math.random().toString(36).substring(2, 15);
  }

  getState(key) {
    return this.state.get(key);
  }

  setState(key, value) {
    this.state.set(key, value);
    return this;
  }

  getHistory() {
    return this.history;
  }

  clearHistory() {
    this.history = [];
    return this;
  }

  async reset() {
    this.state.clear();
    this.history = [];
    this.emit('reset');
    return this;
  }

  toKast() {
    return {
      protocol: 'kast/1',
      version: '1.6.0',
      nodes: (this.history || []).map((h, i) => ({
        id: `h${i}`,
        index: i,
        glyph: h.phase,
        phase: h.phase,
        opcode: 'PHASE',
        symbol: h.phase,
      })),
      edges: (this.history || []).slice(1).map((h, i) => ({
        from: `h${i}`,
        to: `h${i + 1}`,
        kind: 'sequence',
        phase: 'sequence',
      })),
    };
  }
}

// Top-level API matching the user's `kuhul.execute(source, controls)` shape.
async function kuhulExecute(source, opts = {}) {
  const runtime = new KuhulRuntime(opts);
  if (typeof source === 'string' && source.trim().startsWith('{')) {
    // JSON-style program
    return runtime.execute(JSON.parse(source), opts);
  }
  if (typeof source === 'string') {
    // K'UHUL source
    runtime.loadSource(source);
    return runtime.execute({}, opts);
  }
  return runtime.execute(source, opts);
}

const kuhul = {
  execute: kuhulExecute,
  KuhulRuntime,
};

module.exports = {
  KuhulRuntime,
  KastEngine,
  KxmlEngine,
  KuhulConfig,
  PHASES,
  EDGE_KINDS,
  EXPANSION_SPACES,
  kuhulExecute,
  kuhul,
};
