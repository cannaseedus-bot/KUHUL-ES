'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ================================================================
// 1. CORE CONSTANTS & ENUMS
// ================================================================

const PRIORITIES = [
  'balanced', 'precision', 'innovation', 'efficiency',
  'conservation', 'correctness', 'integrity', 'quality',
  'reliability', 'performance'
];

const ROUTING_STRATEGIES = [
  'round_robin', 'least_loaded', 'consistent_hash', 'geographic'
];

const MICRONAUT_STATUS = [
  'created', 'initializing', 'ready', 'running',
  'paused', 'degraded', 'recovering', 'terminating', 'terminated'
];

const PERMISSIONS = [
  'fold:execute', 'fold:compose', 'field:create',
  'field:read', 'field:write', 'tool:use',
  'gram:resolve', 'geodesic:traverse'
];

const FOLD_TYPES = [
  'orchestrator', 'compute', 'storage', 'network',
  'reasoning', 'generation', 'planning', 'persistence',
  'codegen', 'filesystem', 'graphics', 'inference'
];

const NODE_TYPES = [
  'input', 'output', 'process', 'transform',
  'gate', 'memory', 'dispatch'
];

const FIELD_TYPES = [
  'working', 'episodic', 'semantic', 'procedural', 'persistent'
];

const PERSISTENCE = ['volatile', 'persistent', 'ephemeral'];

const ACTION_TYPES = [
  'dispatch', 'mutate', 'halt', 'checkpoint', 'propagate', 'log'
];

const AGENT_TYPES = [
  'worker', 'manager', 'explorer', 'creator', 'helper'
];

const MICRONAUT_XJSON_REQUIRED_SECTIONS = [
  '@meta',
  '@lanes',
  '@phases',
  '@variables',
  '@edges',
  '@agent.main',
  '@model.core',
  '@runtime.gpu',
  '@moe.router',
  '@skills',
  '@experts'
];

const XJSON_PHASE_TO_FOLD_TYPE = {
  Pop: 'planning',
  Wo: 'orchestrator',
  Yax: 'planning',
  Noj: 'reasoning',
  Sek: 'compute',
  "Ch'en": 'persistence',
  Xul: 'planning'
};

const XJSON_FOLD_HINT_TO_TYPE = {
  CONTROL: 'orchestrator',
  DATA: 'storage',
  TIME: 'planning',
  STATE: 'persistence',
  STORAGE: 'storage',
  COMPUTE: 'compute',
  PATTERN: 'reasoning',
  UI: 'graphics',
  META: 'planning',
  NETWORK: 'network',
  CODEGEN: 'codegen',
  FILESYSTEM: 'filesystem',
  INFERENCE: 'inference'
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toSlug(value, fallback) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function normalizeToArray(value) {
  if (Array.isArray(value)) {
    return value.filter(item => item !== undefined && item !== null);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function parseExpertRef(route) {
  if (typeof route !== 'string') return null;
  const normalized = route.trim();
  if (!normalized) return null;
  if (normalized.startsWith('experts.')) {
    return normalized.slice('experts.'.length);
  }
  if (normalized.startsWith('@experts.')) {
    return normalized.slice('@experts.'.length);
  }
  return normalized;
}

function inferFoldType(skill, primaryExpert) {
  const foldHint = skill?.fold || skill?.['@fold'] || null;
  if (typeof foldHint === 'string' && foldHint.trim()) {
    const normalizedHint = foldHint.toUpperCase().replace(/[^A-Z]/g, '');
    if (XJSON_FOLD_HINT_TO_TYPE[normalizedHint]) {
      return XJSON_FOLD_HINT_TO_TYPE[normalizedHint];
    }
  }

  const phase = skill?.phase || skill?.['@phase'] || null;
  if (typeof phase === 'string' && XJSON_PHASE_TO_FOLD_TYPE[phase]) {
    return XJSON_PHASE_TO_FOLD_TYPE[phase];
  }

  const domain = typeof primaryExpert?.domain === 'string'
    ? primaryExpert.domain.toLowerCase()
    : '';
  if (domain.includes('reason')) return 'reasoning';
  if (domain.includes('storage')) return 'storage';
  if (domain.includes('network')) return 'network';
  if (domain.includes('graphics') || domain.includes('ui')) return 'graphics';
  if (domain.includes('inference')) return 'inference';
  if (domain.includes('code')) return 'codegen';

  return 'compute';
}

// ================================================================
// 2. REGISTRY SYSTEM
// ================================================================

class Registry {
  constructor() {
    this._items = new Map();
    this._events = new EventEmitter();
  }

  register(id, item) {
    if (this._items.has(id)) {
      throw new Error(`Item already registered: ${id}`);
    }
    this._items.set(id, item);
    this._events.emit('registered', { id, item });
    return this;
  }

  get(id) {
    if (!this._items.has(id)) {
      throw new Error(`Item not found: ${id}`);
    }
    return this._items.get(id);
  }

  has(id) {
    return this._items.has(id);
  }

  delete(id) {
    if (!this._items.has(id)) {
      return false;
    }
    this._items.delete(id);
    this._events.emit('deleted', { id });
    return true;
  }

  list() {
    return Array.from(this._items.keys());
  }

  find(predicate) {
    const results = [];
    for (const [id, item] of this._items) {
      if (predicate(item, id)) {
        results.push({ id, item });
      }
    }
    return results;
  }

  on(event, handler) {
    this._events.on(event, handler);
    return this;
  }

  off(event, handler) {
    this._events.off(event, handler);
    return this;
  }

  count() {
    return this._items.size;
  }

  clear() {
    this._items.clear();
    this._events.emit('cleared');
    return this;
  }
}

// ================================================================
// 3. TOOL DEFINITION
// ================================================================

class Tool {
  constructor(config) {
    this.id = config.id || this._generateId();
    this.name = config.name || this.id;
    this.fold = config.fold || 'UNASSIGNED';
    this.port = config.port || 0;
    this.signature = config.signature || { input: 'any', output: 'any' };
    this.executeFn = config.execute || ((input) => input);
    this.metadata = config.metadata || {};
    this.created = new Date().toISOString();
    this._validate();
  }

  _validate() {
    if (!this.name) throw new Error('Tool must have a name');
    if (typeof this.executeFn !== 'function') {
      throw new Error('Tool must have an execute function');
    }
  }

  _generateId() {
    return `T-${crypto.randomBytes(4).toString('hex')}`;
  }

  async execute(input, context = {}) {
    try {
      const startTime = Date.now();
      const result = await this.executeFn(input, context);
      const duration = Date.now() - startTime;
      return {
        result,
        duration,
        tool: this.id,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        error: error.message,
        tool: this.id,
        timestamp: new Date().toISOString()
      };
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      fold: this.fold,
      port: this.port,
      signature: this.signature,
      metadata: this.metadata,
      created: this.created
    };
  }
}

// ================================================================
// 4. FIELD DEFINITION
// ================================================================

class Field {
  constructor(config) {
    this.id = config.id || this._generateId();
    this.name = config.name || this.id;
    this.type = config.type || 'working';
    this.persistence = config.persistence || 'volatile';
    this.data = config.data || { rows: 0, cols: 0, values: [] };
    this.metadata = config.metadata || {};
    this.created = new Date().toISOString();
    this._validate();
  }

  _validate() {
    if (!this.name) throw new Error('Field must have a name');
    if (!FIELD_TYPES.includes(this.type)) {
      throw new Error(`Invalid field type: ${this.type}`);
    }
    if (!PERSISTENCE.includes(this.persistence)) {
      throw new Error(`Invalid persistence: ${this.persistence}`);
    }
  }

  _generateId() {
    return `Φ-${crypto.randomBytes(4).toString('hex')}`;
  }

  getRows() { return this.data.rows || 0; }
  getCols() { return this.data.cols || 0; }
  getValues() { return this.data.values || []; }

  setValue(row, col, value) {
    if (!this.data.values) {
      this.data.values = [];
    }
    const idx = row * (this.data.cols || 1) + col;
    this.data.values[idx] = value;
    return this;
  }

  getValue(row, col) {
    if (!this.data.values) return null;
    const idx = row * (this.data.cols || 1) + col;
    return this.data.values[idx];
  }

  toMatrix() {
    const rows = this.getRows();
    const cols = this.getCols();
    const values = this.getValues();
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        row.push(values[idx] || 0);
      }
      matrix.push(row);
    }
    return matrix;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      persistence: this.persistence,
      data: this.data,
      metadata: this.metadata,
      created: this.created
    };
  }
}

// ================================================================
// 5. FOLD DEFINITION (DAG/Graph)
// ================================================================

class Fold {
  constructor(config) {
    this.id = config.id || this._generateId();
    this.name = config.name || this.id;
    this.type = config.type || 'compute';
    this.version = config.version || '1.0.0';
    this.nodes = config.nodes || [];
    this.edges = config.edges || [];
    this.metadata = config.metadata || {};
    this.created = new Date().toISOString();
    this._validate();
  }

  _validate() {
    if (!this.name) throw new Error('Fold must have a name');
    if (!FOLD_TYPES.includes(this.type)) {
      throw new Error(`Invalid fold type: ${this.type}`);
    }
    if (!/^\d+\.\d+\.\d+$/.test(this.version)) {
      throw new Error(`Invalid version: ${this.version}`);
    }
    this._validateNodes();
    this._validateEdges();
  }

  _validateNodes() {
    const ids = new Set();
    for (const node of this.nodes) {
      if (!node.id) throw new Error('Node must have an id');
      if (ids.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
      ids.add(node.id);
      if (!NODE_TYPES.includes(node.type)) {
        throw new Error(`Invalid node type: ${node.type}`);
      }
    }
  }

  _validateEdges() {
    const nodeIds = new Set(this.nodes.map(n => n.id));
    for (const edge of this.edges) {
      if (!nodeIds.has(edge.from)) {
        throw new Error(`Edge from unknown node: ${edge.from}`);
      }
      if (!nodeIds.has(edge.to)) {
        throw new Error(`Edge to unknown node: ${edge.to}`);
      }
    }
  }

  _generateId() {
    return `F-${crypto.randomBytes(4).toString('hex')}`;
  }

  getNode(id) {
    return this.nodes.find(n => n.id === id);
  }

  getEdgesFrom(id) {
    return this.edges.filter(e => e.from === id);
  }

  getEdgesTo(id) {
    return this.edges.filter(e => e.to === id);
  }

  getInputNodes() {
    return this.nodes.filter(n => n.type === 'input');
  }

  getOutputNodes() {
    return this.nodes.filter(n => n.type === 'output');
  }

  getProcessNodes() {
    return this.nodes.filter(n => n.type === 'process' || n.type === 'transform');
  }

  toDAG() {
    const dag = new Map();
    for (const node of this.nodes) {
      dag.set(node.id, {
        node,
        children: this.getEdgesFrom(node.id).map(e => e.to),
        parents: this.getEdgesTo(node.id).map(e => e.from)
      });
    }
    return dag;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      version: this.version,
      nodes: this.nodes,
      edges: this.edges,
      metadata: this.metadata,
      created: this.created
    };
  }
}

// ================================================================
// 6. GRAM DEFINITION (Symbolic Index)
// ================================================================

class Gram {
  constructor(config) {
    this.id = config.id || this._generateId();
    this.name = config.name || this.id;
    this.arity = config.arity || 1;
    this.binding = config.binding || 'dynamic';
    this.symbols = config.symbols || [];
    this.metadata = config.metadata || {};
    this.created = new Date().toISOString();
    this._validate();
  }

  _validate() {
    if (!this.name) throw new Error('Gram must have a name');
    if (this.arity < 0) throw new Error('Arity must be non-negative');
    if (!['dynamic', 'static', 'lazy'].includes(this.binding)) {
      throw new Error(`Invalid binding: ${this.binding}`);
    }
  }

  _generateId() {
    return `G-${crypto.randomBytes(4).toString('hex')}`;
  }

  getSymbol(name) {
    return this.symbols.find(s => s.name === name);
  }

  addSymbol(symbol) {
    if (this.getSymbol(symbol.name)) {
      throw new Error(`Symbol already exists: ${symbol.name}`);
    }
    this.symbols.push(symbol);
    return this;
  }

  resolve(name, args = []) {
    const symbol = this.getSymbol(name);
    if (!symbol) return null;
    if (symbol.type === 'function') {
      if (args.length !== this.arity) {
        throw new Error(`Invalid arity: expected ${this.arity}, got ${args.length}`);
      }
      return { symbol, args };
    }
    return symbol;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      arity: this.arity,
      binding: this.binding,
      symbols: this.symbols,
      metadata: this.metadata,
      created: this.created
    };
  }
}

// ================================================================
// 7. RULE DEFINITION (XCFE Condition-Action)
// ================================================================

class Rule {
  constructor(config) {
    this.id = config.id || this._generateId();
    this.name = config.name || this.id;
    this.priority = config.priority || 0;
    this.entropyCost = config.entropyCost || 0.1;
    this.cooldownMs = config.cooldownMs || 1000;
    this.condition = config.condition || { field: '', operator: '==', value: null };
    this.action = config.action || { type: 'log', target: '' };
    this.metadata = config.metadata || {};
    this.lastFired = null;
    this.fireCount = 0;
    this.created = new Date().toISOString();
    this._validate();
  }

  _validate() {
    if (!this.name) throw new Error('Rule must have a name');
    if (this.priority < 0) throw new Error('Priority must be non-negative');
    if (this.entropyCost < 0 || this.entropyCost > 1) {
      throw new Error('Entropy cost must be between 0 and 1');
    }
    if (!this.condition.field) throw new Error('Condition must have a field');
    if (!['==', '!=', '<', '<=', '>', '>=', 'contains', 'matches'].includes(this.condition.operator)) {
      throw new Error(`Invalid operator: ${this.condition.operator}`);
    }
    if (!ACTION_TYPES.includes(this.action.type)) {
      throw new Error(`Invalid action type: ${this.action.type}`);
    }
  }

  _generateId() {
    return `X-${crypto.randomBytes(4).toString('hex')}`;
  }

  evaluate(context) {
    const value = this._getValue(context, this.condition.field);
    const expected = this.condition.value;
    const operator = this.condition.operator;

    switch (operator) {
      case '==': return value == expected;
      case '!=': return value != expected;
      case '<': return value < expected;
      case '<=': return value <= expected;
      case '>': return value > expected;
      case '>=': return value >= expected;
      case 'contains': return String(value).includes(String(expected));
      case 'matches': return new RegExp(expected).test(String(value));
      default: return false;
    }
  }

  _getValue(context, path) {
    const parts = path.split('.');
    let value = context;
    for (const part of parts) {
      if (value === null || value === undefined) return null;
      value = value[part];
    }
    return value;
  }

  async execute(context, dispatcher) {
    if (this.cooldownMs > 0 && this.lastFired) {
      const elapsed = Date.now() - this.lastFired;
      if (elapsed < this.cooldownMs) {
        return { fired: false, reason: 'cooldown' };
      }
    }

    this.lastFired = Date.now();
    this.fireCount++;

    const action = this.action;
    const params = action.params || {};

    switch (action.type) {
      case 'dispatch':
        return dispatcher.dispatch(action.target, params, context);
      case 'mutate':
        return this._mutate(context, action.target, params);
      case 'halt':
        return { halted: true, reason: params.reason || 'Rule halt' };
      case 'checkpoint':
        return { checkpoint: true, data: params };
      case 'propagate':
        return dispatcher.propagate(action.target, params, context);
      case 'log':
        return { logged: true, message: params.message || 'Rule fired' };
      default:
        return { fired: false, reason: 'Unknown action' };
    }
  }

  _mutate(context, target, params) {
    const parts = target.split('.');
    let obj = context;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = params.value;
    return { mutated: true, field: target, value: params.value };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      priority: this.priority,
      entropyCost: this.entropyCost,
      cooldownMs: this.cooldownMs,
      condition: this.condition,
      action: this.action,
      metadata: this.metadata,
      fireCount: this.fireCount,
      lastFired: this.lastFired,
      created: this.created
    };
  }
}

// ================================================================
// 8. AGENT DEFINITION
// ================================================================

class Agent {
  constructor(config) {
    this.id = config.id || this._generateId();
    this.name = config.name || this.id;
    this.type = config.type || 'worker';
    this.tools = config.tools || [];
    this.goals = config.goals || [];
    this.constraints = config.constraints || [];
    this.state = config.state || { status: 'created', coherence: 1.0, entropy: 0.0 };
    this.metadata = config.metadata || {};
    this.created = new Date().toISOString();
    this._validate();
  }

  _validate() {
    if (!this.name) throw new Error('Agent must have a name');
    if (!AGENT_TYPES.includes(this.type)) {
      throw new Error(`Invalid agent type: ${this.type}`);
    }
  }

  _generateId() {
    return `A-${crypto.randomBytes(4).toString('hex')}`;
  }

  async execute(task, context = {}) {
    const startTime = Date.now();
    let result = { status: 'success', output: null };

    try {
      for (const toolId of this.tools) {
        const tool = ToolRegistry.get(toolId);
        if (tool) {
          const response = await tool.execute(task, context);
          if (response.error) {
            result = { status: 'error', error: response.error };
            break;
          }
          task = response.result;
        }
      }
      result.output = task;
    } catch (error) {
      result = { status: 'error', error: error.message };
    }

    return {
      ...result,
      duration: Date.now() - startTime,
      agent: this.id,
      timestamp: new Date().toISOString()
    };
  }

  addGoal(goal) {
    this.goals.push(goal);
    return this;
  }

  addConstraint(constraint) {
    this.constraints.push(constraint);
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      tools: this.tools,
      goals: this.goals,
      constraints: this.constraints,
      state: this.state,
      metadata: this.metadata,
      created: this.created
    };
  }
}

// ================================================================
// 9. MICRONAUT - Main Orchestrator
// ================================================================

class Micronaut extends EventEmitter {
  constructor(config) {
    super();
    this.id = config.id || this._generateId();
    this.name = config.name || this.id;
    this.identity = {
      name: config.name || this.id,
      role: config.role || 'orchestrator',
      version: config.version || '1.0.0',
      type: 'orchestrator',
      created: new Date().toISOString()
    };
    this.orchestrates = config.orchestrates || [];
    this.policy = {
      priority: config.priority || 'balanced',
      entropy_budget: config.entropy_budget || 0.5,
      timeout_ms: config.timeout_ms || 30000,
      retry_policy: config.retry_policy || { max_attempts: 3, backoff_ms: 1000 }
    };
    this.routing = {
      strategy: config.routing_strategy || 'round_robin',
      capability_map: config.capability_map || {}
    };
    this.permissions = config.permissions || ['fold:execute', 'field:read'];
    this.state = {
      status: 'created',
      coherence: 1.0,
      entropy: 0.0,
      uptime_ms: 0,
      last_action: new Date().toISOString()
    };
    this.memory = {
      field: config.memory_field || null,
      working: config.memory_working || null,
      episodic: config.memory_episodic || null
    };
    this.tools = config.tools || [];
    this.hierarchy = {
      parent: config.parent || null,
      children: config.children || []
    };
    this.metrics = {
      folds_executed: 0,
      fields_projected: 0,
      grams_resolved: 0,
      traversals_completed: 0,
      errors: 0,
      avg_latency_ms: 0
    };
    this.lifecycle = config.lifecycle || {
      on_before_create: [],
      on_after_create: [],
      on_before_start: [],
      on_after_start: [],
      on_before_stop: [],
      on_after_stop: [],
      on_error: []
    };
    this.metadata = config.metadata || {};
    this._startTime = null;
    this._context = new Map();
    this._rules = [];
    this._validators = [];
    this._validateConfig(config);
  }

  _validateConfig(config) {
    if (!config.name) throw new Error('Micronaut must have a name');
    if (config.priority && !PRIORITIES.includes(config.priority)) {
      throw new Error(`Invalid priority: ${config.priority}`);
    }
    if (config.routing_strategy && !ROUTING_STRATEGIES.includes(config.routing_strategy)) {
      throw new Error(`Invalid routing strategy: ${config.routing_strategy}`);
    }
  }

  _generateId() {
    return `M-${crypto.randomBytes(4).toString('hex')}`;
  }

  // ============================================================
  // 10. LIFECYCLE MANAGEMENT
  // ============================================================

  async create() {
    this.emit('before_create', this);
    await this._executeLifecycle('on_before_create');
    this.state.status = 'initializing';
    await this._executeLifecycle('on_after_create');
    this.emit('after_create', this);
    return this;
  }

  async start() {
    this.emit('before_start', this);
    if (this._uptimeTimer) {
      clearTimeout(this._uptimeTimer);
      this._uptimeTimer = null;
    }
    await this._executeLifecycle('on_before_start');
    this.state.status = 'running';
    this._startTime = Date.now();
    this.state.uptime_ms = 0;
    await this._executeLifecycle('on_after_start');
    this.emit('after_start', this);
    this._updateUptime();
    return this;
  }

  async stop() {
    this.emit('before_stop', this);
    await this._executeLifecycle('on_before_stop');
    this.state.status = 'terminating';
    if (this._uptimeTimer) {
      clearTimeout(this._uptimeTimer);
      this._uptimeTimer = null;
    }
    await this._executeLifecycle('on_after_stop');
    this.state.status = 'terminated';
    this.emit('after_stop', this);
    return this;
  }

  async pause() {
    if (this.state.status !== 'running') {
      throw new Error('Cannot pause: not running');
    }
    this.state.status = 'paused';
    this.emit('paused', this);
    return this;
  }

  async resume() {
    if (this.state.status !== 'paused') {
      throw new Error('Cannot resume: not paused');
    }
    this.state.status = 'running';
    this.emit('resumed', this);
    this._updateUptime();
    return this;
  }

  _updateUptime() {
    if (this.state.status === 'running' && this._startTime) {
      this.state.uptime_ms = Date.now() - this._startTime;
      this._uptimeTimer = setTimeout(() => this._updateUptime(), 1000);
    } else {
      this._uptimeTimer = null;
    }
  }

  async _executeLifecycle(event) {
    const actions = this.lifecycle[event] || [];
    for (const action of actions) {
      try {
        await this._executeAction(action);
      } catch (error) {
        this.emit('error', { event, action, error });
        await this._executeLifecycle('on_error');
      }
    }
  }

  async _executeAction(action) {
    if (typeof action === 'function') {
      return action(this);
    }
    if (action.action === 'log') {
      console.log(`[${this.id}] ${action.params?.message || 'Lifecycle action'}`);
    }
    return action;
  }

  // ============================================================
  // 11. ORCHESTRATION METHODS
  // ============================================================

  async orchestrate(task, context = {}) {
    this.emit('orchestrating', { task, context });
    this._checkPermissions('fold:execute');

    const foldId = this._selectFold(task);
    const fold = FoldRegistry.get(foldId);
    if (!fold) {
      throw new Error(`Fold not found: ${foldId}`);
    }

    let attempts = 0;
    let lastError = null;
    const maxAttempts = this.policy.retry_policy.max_attempts;
    const backoffMs = this.policy.retry_policy.backoff_ms;

    // Surface the task to DAG input nodes via context.input so the task's
    // fields are visible to tools downstream.
    const execContext = { ...context, input: context.input !== undefined ? context.input : task };

    while (attempts < maxAttempts) {
      try {
        const result = await this._executeFold(fold, task, execContext);
        this._updateMetrics('folds_executed');
        this.state.last_action = new Date().toISOString();
        this.emit('orchestrated', { task, result });
        return result;
      } catch (error) {
        lastError = error;
        attempts++;
        if (attempts < maxAttempts) {
          await this._sleep(backoffMs * attempts);
        }
      }
    }

    throw lastError || new Error('Execution failed after retries');
  }

  _selectFold(task) {
    const folds = this.orchestrates;
    if (folds.length === 0) {
      throw new Error('No folds to orchestrate');
    }

    // Action-aware routing: prefer a fold whose name or metadata matches
    // task.action, then fall back to the configured routing strategy.
    if (task && typeof task === 'object' && typeof task.action === 'string') {
      const action = task.action;
      for (const foldId of folds) {
        if (!FoldRegistry.has(foldId)) continue;
        const fold = FoldRegistry.get(foldId);
        const actions = Array.isArray(fold.metadata?.actions) ? fold.metadata.actions : [];
        if (fold.name === action || fold.metadata?.action === action || actions.includes(action)) {
          return foldId;
        }
      }
    }

    switch (this.routing.strategy) {
      case 'round_robin':
        return this._roundRobin(folds);
      case 'least_loaded':
        return this._leastLoaded(folds);
      case 'consistent_hash':
        return this._consistentHash(folds, task);
      case 'geographic':
        return this._geographic(folds, task);
      default:
        return folds[0];
    }
  }

  _roundRobin(folds) {
    if (!this._roundRobinIndex) this._roundRobinIndex = 0;
    const idx = this._roundRobinIndex % folds.length;
    this._roundRobinIndex = (this._roundRobinIndex + 1) % folds.length;
    return folds[idx];
  }

  _leastLoaded(folds) {
    let minLoad = Infinity;
    let selected = folds[0];
    for (const foldId of folds) {
      if (FoldRegistry.has(foldId)) {
        const fold = FoldRegistry.get(foldId);
        const load = fold.metadata?.load || 0;
        if (load < minLoad) {
          minLoad = load;
          selected = foldId;
        }
      }
    }
    return selected;
  }

  _consistentHash(folds, task) {
    const hash = crypto.createHash('md5')
      .update(JSON.stringify(task))
      .digest('hex');
    const idx = parseInt(hash.substring(0, 8), 16) % folds.length;
    return folds[idx];
  }

  _geographic(folds, task) {
    const region = task.region || 'default';
    for (const foldId of folds) {
      if (FoldRegistry.has(foldId)) {
        const fold = FoldRegistry.get(foldId);
        if (fold.metadata?.region === region) {
          return foldId;
        }
      }
    }
    return folds[0];
  }

  async _executeFold(fold, task, context) {
    const dag = fold.toDAG();
    const results = new Map();
    const executionOrder = this._topologicalSort(dag);

    for (const nodeId of executionOrder) {
      const dagNode = dag.get(nodeId);
      const node = dagNode.node;
      const inputs = this._gatherInputs(nodeId, dag, results);
      const result = await this._executeNode(node, inputs, context);
      results.set(nodeId, result);
      if (result && result.error) {
        throw new Error(`Node ${nodeId} failed: ${result.error}`);
      }
    }

    const output = {};
    for (const nodeId of fold.getOutputNodes().map(n => n.id)) {
      output[nodeId] = results.get(nodeId);
    }
    // Canonical result contract: the first output node's result is exposed
    // as `output` in addition to the per-node-id keys.
    const outputNodes = fold.getOutputNodes();
    if (outputNodes.length > 0) {
      output.output = results.get(outputNodes[0].id);
    }
    return output;
  }

  _topologicalSort(dag) {
    const visited = new Set();
    const sorted = [];
    const temp = new Set();

    const visit = (nodeId) => {
      if (temp.has(nodeId)) {
        throw new Error('Cycle detected in DAG');
      }
      if (visited.has(nodeId)) return;

      temp.add(nodeId);
      const node = dag.get(nodeId);
      for (const child of node.children) {
        visit(child);
      }
      temp.delete(nodeId);
      visited.add(nodeId);
      sorted.push(nodeId);
    };

    for (const nodeId of dag.keys()) {
      if (!visited.has(nodeId)) {
        visit(nodeId);
      }
    }

    // Post-order pushes children before parents; execution needs parents
    // first, so reverse into dependency order.
    sorted.reverse();
    return sorted;
  }

  _gatherInputs(nodeId, dag, results) {
    const inputs = {};
    const node = dag.get(nodeId);
    for (const parent of node.parents) {
      const parentResult = results.get(parent);
      if (parentResult !== undefined) {
        inputs[parent] = parentResult;
      }
    }
    return inputs;
  }

  async _executeNode(node, inputs, context) {
    const startTime = Date.now();
    let result = {};

    switch (node.type) {
      case 'input':
        result = { value: inputs.value || context.input || context };
        break;
      case 'output':
        result = { value: inputs.output || inputs };
        break;
      case 'process':
        result = await this._executeProcess(node, inputs, context);
        break;
      case 'transform':
        result = await this._executeTransform(node, inputs, context);
        break;
      case 'gate':
        result = await this._executeGate(node, inputs, context);
        break;
      case 'memory':
        result = await this._executeMemory(node, inputs, context);
        break;
      case 'dispatch':
        result = await this._executeDispatch(node, inputs, context);
        break;
      default:
        result = { error: `Unknown node type: ${node.type}` };
    }

    const duration = Date.now() - startTime;
    this._updateMetrics('avg_latency_ms', duration);
    return { ...result, _duration: duration };
  }

  async _executeProcess(node, inputs, context) {
    const toolId = node.config?.tool || this.tools[0];
    if (!toolId) {
      return { error: 'No tool configured for process' };
    }
    const tool = ToolRegistry.get(toolId);
    if (!tool) {
      return { error: `Tool not found: ${toolId}` };
    }
    // Give the tool the parent-output map AND the task fields, so domain
    // tools written against the task shape (input.spec, input.code, ...) work.
    const task = context.input;
    const toolInput = isPlainObject(task)
      ? { ...inputs, ...task }
      : { ...inputs, input: task };
    // Flatten input/transform/output payloads (`{ value: X }`) from parent
    // nodes so tools that read flat field names (input.assessment, ...) work.
    for (const key of Object.keys(inputs)) {
      const v = inputs[key];
      if (isPlainObject(v) && v.value !== undefined && isPlainObject(v.value)) {
        Object.assign(toolInput, v.value);
      }
    }
    return tool.execute(toolInput, context);
  }

  async _executeTransform(node, inputs, context) {
    const transform = node.config?.transform;
    if (typeof transform === 'function') {
      return { value: transform(inputs) };
    }
    return { value: inputs };
  }

  async _executeGate(node, inputs, context) {
    const condition = node.config?.condition;
    if (typeof condition === 'function') {
      if (condition(inputs, context)) {
        return { passed: true, value: inputs };
      }
      return { passed: false, blocked: true };
    }
    return { value: inputs };
  }

  async _executeMemory(node, inputs, context) {
    const fieldId = node.config?.field || this.memory.working;
    if (!fieldId) {
      return { error: 'No field configured for memory' };
    }
    const field = FieldRegistry.get(fieldId);
    if (!field) {
      return { error: `Field not found: ${fieldId}` };
    }

    if (node.config?.operation === 'write') {
      field.setValue(0, 0, inputs.value);
      return { written: true };
    }
    return { value: field.getValue(0, 0) };
  }

  async _executeDispatch(node, inputs, context) {
    const target = node.config?.target;
    if (!target) {
      return { error: 'No target configured for dispatch' };
    }

    if (FoldRegistry.has(target)) {
      const fold = FoldRegistry.get(target);
      return this._executeFold(fold, inputs, context);
    }

    if (AgentRegistry.has(target)) {
      const agent = AgentRegistry.get(target);
      return agent.execute(inputs, context);
    }

    return { error: `Target not found: ${target}` };
  }

  // ============================================================
  // 12. PERMISSIONS & VALIDATION
  // ============================================================

  _checkPermissions(permission) {
    if (!this.permissions.includes(permission)) {
      throw new Error(`Permission denied: ${permission}`);
    }
  }

  _updateMetrics(metric, value = 1) {
    if (typeof value === 'number') {
      if (metric === 'avg_latency_ms') {
        const current = this.metrics.avg_latency_ms;
        const count = this.metrics.folds_executed || 1;
        this.metrics.avg_latency_ms = (current * (count - 1) + value) / count;
      } else {
        this.metrics[metric] = (this.metrics[metric] || 0) + value;
      }
    }
  }

  addValidator(validator) {
    this._validators.push(validator);
    return this;
  }

  validateState() {
    for (const validator of this._validators) {
      if (!validator(this)) {
        throw new Error(`Validation failed: ${validator.name}`);
      }
    }
    return true;
  }

  // ============================================================
  // 13. RULE MANAGEMENT
  // ============================================================

  addRule(rule) {
    if (!(rule instanceof Rule)) {
      rule = new Rule(rule);
    }
    this._rules.push(rule);
    return this;
  }

  async evaluateRules(context = {}) {
    const fired = [];
    const sortedRules = [...this._rules].sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (rule.evaluate(context)) {
        const result = await rule.execute(context, this);
        fired.push({ rule: rule.id, result });
      }
    }

    return fired;
  }

  // ============================================================
  // 14. COMMUNICATION
  // ============================================================

  async send(target, message) {
    this.emit('message', { from: this.id, to: target, message });

    if (MicronautRegistry.has(target)) {
      const micronaut = MicronautRegistry.get(target);
      return micronaut.receive(this.id, message);
    }

    if (AgentRegistry.has(target)) {
      const agent = AgentRegistry.get(target);
      return agent.execute(message);
    }

    throw new Error(`Target not found: ${target}`);
  }

  async receive(from, message) {
    this.emit('received', { from, message });
    const context = { from, message };
    const rules = await this.evaluateRules(context);
    return { received: true, rules };
  }

  dispatch(target, params, context) {
    this.emit('dispatch', { target, params, context });
    return { dispatched: true, target, params };
  }

  propagate(target, params, context) {
    this.emit('propagate', { target, params, context });
    return { propagated: true, target, params };
  }

  // ============================================================
  // 15. UTILITY METHODS
  // ============================================================

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      identity: this.identity,
      orchestrates: this.orchestrates,
      policy: this.policy,
      routing: this.routing,
      permissions: this.permissions,
      state: this.state,
      memory: this.memory,
      tools: this.tools,
      hierarchy: this.hierarchy,
      metrics: this.metrics,
      lifecycle: this.lifecycle,
      metadata: this.metadata,
      rules: this._rules.map(r => r.toJSON())
    };
  }

  getStatus() {
    return {
      id: this.id,
      status: this.state.status,
      uptime_ms: this.state.uptime_ms,
      coherence: this.state.coherence,
      entropy: this.state.entropy,
      folds_executed: this.metrics.folds_executed,
      errors: this.metrics.errors
    };
  }
}

// ================================================================
// 16. GLOBAL REGISTRIES
// ================================================================

const MicronautRegistry = new Registry();
const FoldRegistry = new Registry();
const FieldRegistry = new Registry();
const ToolRegistry = new Registry();
const GramRegistry = new Registry();
const AgentRegistry = new Registry();
const RuleRegistry = new Registry();

// ================================================================
// 17. MICRONAUT FACTORY
// ================================================================

class MicronautFactory {
  static createMicronaut(config) {
    return new Micronaut(config);
  }

  static createFold(config) {
    return new Fold(config);
  }

  static createField(config) {
    return new Field(config);
  }

  static createTool(config) {
    return new Tool(config);
  }

  static createGram(config) {
    return new Gram(config);
  }

  static createAgent(config) {
    return new Agent(config);
  }

  static createRule(config) {
    return new Rule(config);
  }

  static _xjsonEntries(block) {
    if (!isPlainObject(block)) return [];
    return Object.entries(block)
      .filter(([key, value]) => !key.startsWith('@') && isPlainObject(value))
      .map(([key, value]) => ({ key, value }));
  }

  static _resolveSkillRouteTools(skillConfig, expertToolByKey, expertToolById, fallbackToolIds) {
    const routeRefs = normalizeToArray(skillConfig?.routes_to);
    const routeToolIds = [];
    for (const routeRef of routeRefs) {
      const expertRef = parseExpertRef(routeRef);
      if (!expertRef) continue;
      if (expertToolByKey.has(expertRef)) {
        routeToolIds.push(expertToolByKey.get(expertRef));
        continue;
      }
      if (expertToolById.has(expertRef)) {
        routeToolIds.push(expertToolById.get(expertRef));
        continue;
      }
      if (ToolRegistry.has(expertRef)) {
        routeToolIds.push(expertRef);
      }
    }
    if (routeToolIds.length > 0) {
      return Array.from(new Set(routeToolIds));
    }
    return [...fallbackToolIds];
  }

  static _validateXjsonDocument(xjson, options = {}) {
    const strict = options.strict !== false;
    if (!isPlainObject(xjson)) {
      throw new Error('XJSON micronaut document must be a JSON object');
    }

    const missingSections = MICRONAUT_XJSON_REQUIRED_SECTIONS
      .filter(section => !Object.prototype.hasOwnProperty.call(xjson, section));
    if (missingSections.length > 0) {
      throw new Error(`XJSON micronaut document missing required sections: ${missingSections.join(', ')}`);
    }

    const meta = xjson['@meta'];
    if (!isPlainObject(meta) || !meta.id || !meta.name) {
      throw new Error('XJSON @meta must include id and name');
    }

    const agentMain = xjson['@agent.main'];
    if (!isPlainObject(agentMain) || !agentMain.id || !agentMain.name) {
      throw new Error('XJSON @agent.main must include id and name');
    }

    const modelCore = xjson['@model.core'];
    if (!isPlainObject(modelCore)) {
      throw new Error('XJSON @model.core must be an object');
    }
    if (strict && modelCore['@xcfe'] !== 'IMMUTABLE') {
      throw new Error('XJSON @model.core must lock "@xcfe": "IMMUTABLE"');
    }

    const backend = xjson['@backend'];
    const backendType = modelCore.backend || backend?.type || null;
    if (typeof backendType === 'string' && backendType.startsWith('api_') && !isPlainObject(backend)) {
      throw new Error('XJSON @backend is required when @model.core.backend uses api_*');
    }

    const experts = MicronautFactory._xjsonEntries(xjson['@experts']);
    if (experts.length === 0) {
      throw new Error('XJSON @experts must define at least one expert');
    }

    const skills = MicronautFactory._xjsonEntries(xjson['@skills']);
    if (skills.length === 0) {
      throw new Error('XJSON @skills must define at least one skill');
    }

    const expertKeySet = new Set(experts.map(({ key }) => key));
    const expertIdSet = new Set(experts.map(({ value }) => value.id).filter(Boolean));
    for (const { key: skillKey, value: skillValue } of skills) {
      for (const routeRef of normalizeToArray(skillValue.routes_to)) {
        const expertRef = parseExpertRef(routeRef);
        if (!expertRef) continue;
        if (!expertKeySet.has(expertRef) && !expertIdSet.has(expertRef)) {
          throw new Error(`XJSON skill "${skillKey}" routes_to unknown expert: ${routeRef}`);
        }
      }
    }

    const edges = Array.isArray(xjson['@edges']) ? xjson['@edges'] : [];
    if (strict) {
      const feedbackEdge = edges.find(edge => isPlainObject(edge) && edge.from === 'experts' && edge.to === 'learned');
      if (!feedbackEdge) {
        throw new Error('XJSON @edges must include experts -> learned feedback edge');
      }
    }

    return { meta, agentMain, modelCore, backend, skills, experts, edges };
  }

  static validateXjson(xjson, options = {}) {
    return MicronautFactory._validateXjsonDocument(xjson, options);
  }

  static fromXjson(xjson, options = {}) {
    const register = options.register !== false;
    const strict = options.strict !== false;
    const sourceFile = options.sourceFile || null;
    const {
      meta,
      agentMain,
      modelCore,
      backend,
      skills,
      experts,
      edges
    } = MicronautFactory._validateXjsonDocument(xjson, { strict });

    const datasetPath = options.datasetPath || null;
    if (datasetPath !== null && (typeof datasetPath !== 'string' || !datasetPath.trim())) {
      throw new Error('datasetPath must be a non-empty string when provided');
    }
    if (typeof datasetPath === 'string' && !datasetPath.toLowerCase().endsWith('.jsonl')) {
      throw new Error('datasetPath must point to a .jsonl file');
    }

    const createdTools = [];
    const createdFolds = [];
    const createdFields = [];
    const expertToolByKey = new Map();
    const expertToolById = new Map();

    const toolIdsSeen = new Set();
    for (const { key: expertKey, value: expertConfig } of experts) {
      const toolId = expertConfig.id || `tool-${toSlug(meta.id, 'micronaut')}-${toSlug(expertKey, 'expert')}`;
      if (toolIdsSeen.has(toolId)) {
        throw new Error(`XJSON experts resolve to duplicate tool id: ${toolId}`);
      }
      toolIdsSeen.add(toolId);

      const tool = MicronautFactory.createTool({
        id: toolId,
        name: expertConfig.id || expertKey,
        fold: expertConfig.fold || 'COMPUTE',
        signature: { input: 'any', output: 'json' },
        execute: async (input) => ({
          expert: expertKey,
          expert_id: expertConfig.id || expertKey,
          dispatch_signal: expertConfig.dispatch_signal || expertConfig.adam_micronaut_key || expertKey,
          domain: expertConfig.domain || null,
          input
        }),
        metadata: {
          source: 'xjson',
          xjson_ref: `@experts.${expertKey}`,
          routing_bias: expertConfig.routing_bias ?? null
        }
      });

      if (register) {
        if (ToolRegistry.has(tool.id)) {
          throw new Error(`Tool already registered: ${tool.id}`);
        }
        ToolRegistry.register(tool.id, tool);
      }

      createdTools.push(tool);
      expertToolByKey.set(expertKey, tool.id);
      expertToolById.set(tool.id, tool.id);
      if (expertConfig.id) {
        expertToolById.set(expertConfig.id, tool.id);
      }
    }

    const fallbackToolIds = createdTools.map(tool => tool.id);
    const foldIdsSeen = new Set();
    for (const { key: skillKey, value: skillConfig } of skills) {
      const routeToolIds = MicronautFactory._resolveSkillRouteTools(
        skillConfig,
        expertToolByKey,
        expertToolById,
        fallbackToolIds
      );
      if (routeToolIds.length === 0) {
        throw new Error(`Unable to resolve tools for XJSON skill: ${skillKey}`);
      }

      const routeExpertRefs = normalizeToArray(skillConfig.routes_to)
        .map(parseExpertRef)
        .filter(Boolean);
      const primaryExpertRef = routeExpertRefs[0] || experts[0]?.key || null;
      const primaryExpert = experts.find(({ key }) => key === primaryExpertRef)?.value || experts[0]?.value || null;
      const foldType = inferFoldType(skillConfig, primaryExpert);

      const foldId = skillConfig.id || `fold-${toSlug(meta.id, 'micronaut')}-${toSlug(skillKey, 'skill')}`;
      if (foldIdsSeen.has(foldId)) {
        throw new Error(`XJSON skills resolve to duplicate fold id: ${foldId}`);
      }
      foldIdsSeen.add(foldId);

      const nodes = [{ id: 'input', type: 'input' }];
      const foldEdges = [];
      let previousNodeId = 'input';
      routeToolIds.forEach((toolId, index) => {
        const nodeId = `route-${index + 1}`;
        nodes.push({
          id: nodeId,
          type: 'process',
          config: { tool: toolId }
        });
        foldEdges.push({ from: previousNodeId, to: nodeId });
        previousNodeId = nodeId;
      });
      nodes.push({ id: 'output', type: 'output' });
      foldEdges.push({ from: previousNodeId, to: 'output' });

      const fold = MicronautFactory.createFold({
        id: foldId,
        name: skillConfig.id || skillKey,
        type: foldType,
        version: meta.version || '1.0.0',
        nodes,
        edges: foldEdges,
        metadata: {
          source: 'xjson',
          xjson_ref: `@skills.${skillKey}`,
          trigger: skillConfig.trigger ?? null,
          routes_to: normalizeToArray(skillConfig.routes_to),
          phase: skillConfig['@phase'] || skillConfig.phase || null
        }
      });

      if (register) {
        if (FoldRegistry.has(fold.id)) {
          throw new Error(`Fold already registered: ${fold.id}`);
        }
        FoldRegistry.register(fold.id, fold);
      }
      createdFolds.push(fold);
    }

    const memoryFieldData = isPlainObject(agentMain.memory) ? { ...agentMain.memory } : {};
    const memoryField = MicronautFactory.createField({
      id: `field-${toSlug(meta.id, 'micronaut')}-memory`,
      name: `${meta.id}-memory`,
      type: 'working',
      persistence: 'persistent',
      data: {
        rows: 1,
        cols: 1,
        values: [memoryFieldData]
      },
      metadata: {
        source: 'xjson',
        xjson_ref: '@agent.main.memory'
      }
    });
    if (register) {
      if (FieldRegistry.has(memoryField.id)) {
        throw new Error(`Field already registered: ${memoryField.id}`);
      }
      FieldRegistry.register(memoryField.id, memoryField);
    }
    createdFields.push(memoryField);

    const routerTopK = Number(xjson?.['@moe.router']?.top_k_experts || 1);
    const routingStrategy = options.routing_strategy
      || (createdFolds.length > 1 || routerTopK > 1 ? 'round_robin' : 'consistent_hash');
    const permissions = Array.isArray(options.permissions) && options.permissions.length > 0
      ? options.permissions
      : ['fold:execute', 'field:read', 'tool:use'];

    const micronaut = MicronautFactory.createMicronaut({
      id: meta.id,
      name: agentMain.name || meta.name || meta.id,
      role: agentMain.persona || meta.description || 'orchestrator',
      version: meta.version || '1.0.0',
      orchestrates: createdFolds.map(fold => fold.id),
      priority: options.priority || 'balanced',
      routing_strategy: routingStrategy,
      permissions,
      tools: createdTools.map(tool => tool.id),
      memory_field: memoryField.id,
      memory_working: memoryField.id,
      metadata: {
        source: 'xjson',
        source_file: sourceFile,
        xjson_sections: MICRONAUT_XJSON_REQUIRED_SECTIONS,
        backend: modelCore.backend || backend?.type || null,
        model_id: modelCore.id || null,
        runtime_gpu_backend: xjson?.['@runtime.gpu']?.backend || null,
        top_k_experts: routerTopK,
        feedback_edges: edges.filter(edge => isPlainObject(edge) && edge.from === 'experts' && edge.to === 'learned').length,
        model_weights_stb: options.stbPath || null,
        training_dataset_jsonl: datasetPath
      }
    });

    if (register) {
      if (MicronautRegistry.has(micronaut.id)) {
        throw new Error(`Micronaut already registered: ${micronaut.id}`);
      }
      MicronautRegistry.register(micronaut.id, micronaut);
    }

    return {
      micronaut,
      tools: createdTools,
      folds: createdFolds,
      fields: createdFields,
      xjson
    };
  }

  static fromXjsonFile(filePath, options = {}) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('fromXjsonFile requires a file path');
    }
    const resolvedPath = path.resolve(filePath);
    if (resolvedPath.toLowerCase().endsWith('.stb')) {
      throw new Error('Micronaut definitions are XJSON. Use options.stbPath to attach .stb model weights metadata.');
    }
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid XJSON file at ${resolvedPath}: ${error.message}`);
    }
    return MicronautFactory.fromXjson(parsed, { ...options, sourceFile: resolvedPath });
  }

  static fromJSON(data) {
    switch (data.type) {
      case 'micronaut': return MicronautFactory.createMicronaut(data.config);
      case 'fold': return MicronautFactory.createFold(data.config);
      case 'field': return MicronautFactory.createField(data.config);
      case 'tool': return MicronautFactory.createTool(data.config);
      case 'gram': return MicronautFactory.createGram(data.config);
      case 'agent': return MicronautFactory.createAgent(data.config);
      case 'rule': return MicronautFactory.createRule(data.config);
      default: throw new Error(`Unknown type: ${data.type}`);
    }
  }
}

// ================================================================
// 18. EXPORTS
// ================================================================

module.exports = {
  Micronaut,
  Fold,
  Field,
  Tool,
  Gram,
  Agent,
  Rule,
  Registry,
  MicronautRegistry,
  FoldRegistry,
  FieldRegistry,
  ToolRegistry,
  GramRegistry,
  AgentRegistry,
  RuleRegistry,
  MicronautFactory,
  PRIORITIES,
  ROUTING_STRATEGIES,
  MICRONAUT_STATUS,
  PERMISSIONS,
  FOLD_TYPES,
  NODE_TYPES,
  FIELD_TYPES,
  PERSISTENCE,
  ACTION_TYPES,
  AGENT_TYPES,
  MICRONAUT_XJSON_REQUIRED_SECTIONS
};