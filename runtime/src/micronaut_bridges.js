'use strict';

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { powernautGlslTransport } = require('./transports/powernaut_glsl_transport.js');
const { xvmD3d12Transport, DEFAULT_XVM_DIR } = require('./transports/xvm_d3d12_transport.js');
const { hybridClusterGlslTransport } = require('./transports/hybrid_cluster_glsl_transport.js');

class MicronautBridge extends EventEmitter {
  constructor(config = {}) {
    super();
    this.id = config.id || `bridge-${crypto.randomBytes(4).toString('hex')}`;
    this.name = config.name || this.id;
    this.type = config.type || 'bridge';
    this.direction = config.direction || 'bidirectional';
    this.protocol = config.protocol || 'kast/1';
    this.version = config.version || '1.0.0';
    this.capabilities = config.capabilities || [];
    this.filters = config.filters || [];
    this.transformers = config.transformers || [];
    this.metadata = config.metadata || {};
    this.state = {
      status: 'initialized',
      connected: false,
      lastActivity: null,
      metrics: {
        messages_sent: 0,
        messages_received: 0,
        errors: 0,
        avg_latency_ms: 0,
      },
    };
    this._connections = new Map();
  }

  _key(target) {
    return target == null ? '__default__' : String(target);
  }

  async connect(target = '__default__', options = {}) {
    const key = this._key(target);
    const connection = await this._establishConnection(target, options);
    this._connections.set(key, connection);
    this.state.connected = true;
    this.state.status = 'connected';
    this.state.lastActivity = new Date().toISOString();
    this.emit('connected', { target, key });
    return connection;
  }

  async disconnect(target = '__default__') {
    const key = this._key(target);
    const connection = this._connections.get(key);
    if (connection) {
      await this._closeConnection(connection);
      this._connections.delete(key);
      this.emit('disconnected', { target, key });
    }
    if (this._connections.size === 0) {
      this.state.connected = false;
      this.state.status = 'disconnected';
    }
    return true;
  }

  async send(target = '__default__', message = {}, options = {}) {
    const key = this._key(target);
    if (!this._connections.has(key)) {
      throw new Error(`Not connected to target: ${String(target)}`);
    }
    const connection = this._connections.get(key);
    const outbound = await this._applyPipeline(message, 'outbound');

    const started = Date.now();
    try {
      const result = await this._sendMessage(connection, outbound, options);
      this.state.metrics.messages_sent += 1;
      this.state.metrics.avg_latency_ms =
        ((this.state.metrics.avg_latency_ms * (this.state.metrics.messages_sent - 1)) + (Date.now() - started)) /
        this.state.metrics.messages_sent;
      this.state.lastActivity = new Date().toISOString();
      return result;
    } catch (error) {
      this.state.metrics.errors += 1;
      this.emit('error', error);
      throw error;
    }
  }

  async receive(message, source = 'external') {
    this.state.metrics.messages_received += 1;
    this.state.lastActivity = new Date().toISOString();
    const inbound = await this._applyPipeline(message, 'inbound');
    this.emit('message', { source, message: inbound });
    return inbound;
  }

  async _applyPipeline(message, direction) {
    let current = message;
    for (const filter of this.filters) {
      current = await filter(current, { direction });
    }
    for (const transformer of this.transformers) {
      current = await transformer(current, { direction });
    }
    return current;
  }

  addFilter(filter) {
    this.filters.push(filter);
    return this;
  }

  addTransformer(transformer) {
    this.transformers.push(transformer);
    return this;
  }

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      state: this.state,
      connections: Array.from(this._connections.keys()),
      capabilities: this.capabilities,
    };
  }

  async _establishConnection() {
    throw new Error('_establishConnection must be implemented by subclass');
  }

  async _closeConnection() {
    return true;
  }

  async _sendMessage() {
    throw new Error('_sendMessage must be implemented by subclass');
  }
}

class TransportBridge extends MicronautBridge {
  constructor(config = {}) {
    super({
      ...config,
      type: config.type || 'runtime_transport',
      capabilities: config.capabilities || ['health', 'dispatch'],
    });
    this.transportFactory = config.transportFactory;
  }

  async _establishConnection(target, options = {}) {
    if (typeof this.transportFactory !== 'function') {
      throw new Error('TransportBridge requires transportFactory');
    }
    const transport = this.transportFactory({ target, options, metadata: this.metadata });
    if (typeof transport !== 'function') {
      throw new Error('transportFactory must return a function(op, payload)');
    }
    return { target, transport };
  }

  async _sendMessage(connection, message) {
    const op = message.operation || message.op || 'dispatch';
    const payload = message.payload ?? message.data ?? message;
    return connection.transport(op, payload);
  }
}

class PowernautBridge extends TransportBridge {
  constructor(config = {}) {
    const endpoint = config.endpoint || 'http://127.0.0.1:9060';
    const manifest = config.manifest;
    const timeoutMs = config.timeoutMs || 5000;
    super({
      ...config,
      name: config.name || 'powernaut-glsl',
      type: 'runtime_backend',
      capabilities: ['health', 'dispatch', 'compile', 'chain'],
      metadata: { endpoint, manifest, timeoutMs, ...(config.metadata || {}) },
      transportFactory: () => powernautGlslTransport(endpoint, { manifest, timeoutMs }),
    });
  }
}

class XvmD3d12Bridge extends TransportBridge {
  constructor(config = {}) {
    const xvmDir = config.xvmDir || process.env.XVM_D3D12_DIR || DEFAULT_XVM_DIR;
    super({
      ...config,
      name: config.name || 'xvm-d3d12',
      type: 'runtime_backend',
      capabilities: ['health', 'dispatch', 'infer', 'train'],
      metadata: { xvmDir, ...(config.metadata || {}) },
      transportFactory: () => xvmD3d12Transport({ xvmDir }),
    });
  }
}

class HybridClusterGlslBridge extends TransportBridge {
  constructor(config = {}) {
    const xvmDir = config.xvmDir || process.env.XVM_D3D12_DIR || DEFAULT_XVM_DIR;
    const glslEndpoint = config.glslEndpoint || 'http://127.0.0.1:9060';
    const manifest = config.manifest;
    const timeoutMs = config.timeoutMs || 5000;
    super({
      ...config,
      name: config.name || 'hybrid-cluster-glsl',
      type: 'runtime_backend',
      capabilities: ['health', 'dispatch'],
      metadata: { xvmDir, glslEndpoint, manifest, timeoutMs, ...(config.metadata || {}) },
      transportFactory: () => hybridClusterGlslTransport({ xvmDir, glslEndpoint, manifest, timeoutMs }),
    });
  }
}

class FileSystemBridge extends MicronautBridge {
  constructor(config = {}) {
    super({
      ...config,
      name: config.name || 'filesystem',
      type: 'filesystem',
      capabilities: ['read', 'write', 'list', 'delete'],
      metadata: {
        basePath: config.basePath || process.cwd(),
        allowedExtensions: config.allowedExtensions || ['.txt', '.json', '.khl', '.kson'],
        ...(config.metadata || {}),
      },
    });
  }

  async _establishConnection(target = '.', options = {}) {
    const basePath = path.resolve(this.metadata.basePath, String(target));
    if (!fs.existsSync(basePath)) {
      if (options.create) {
        fs.mkdirSync(basePath, { recursive: true });
      } else {
        throw new Error(`Path does not exist: ${basePath}`);
      }
    }
    return { basePath };
  }

  async _sendMessage(connection, message) {
    const operation = message.operation || message.op;
    const data = message.data || message.payload || {};
    switch (operation) {
      case 'read':
        return this._read(connection.basePath, data.path);
      case 'write':
        return this._write(connection.basePath, data.path, data.content || '');
      case 'list':
        return this._list(connection.basePath, data.path || '');
      case 'delete':
        return this._delete(connection.basePath, data.path);
      default:
        throw new Error(`Unknown filesystem operation: ${operation}`);
    }
  }

  _ensureAllowed(filePath) {
    const ext = path.extname(filePath);
    if (this.metadata.allowedExtensions.length && !this.metadata.allowedExtensions.includes(ext)) {
      throw new Error(`File type not allowed: ${filePath}`);
    }
  }

  _read(basePath, relPath) {
    const filePath = path.resolve(basePath, relPath || '');
    this._ensureAllowed(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    return { path: filePath, content, size: content.length };
  }

  _write(basePath, relPath, content) {
    const filePath = path.resolve(basePath, relPath || '');
    this._ensureAllowed(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return { path: filePath, written: true, size: content.length };
  }

  _list(basePath, relPath = '') {
    const dirPath = path.resolve(basePath, relPath);
    const files = fs.readdirSync(dirPath);
    return files.map((name) => {
      const filePath = path.join(dirPath, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        path: filePath,
        isDirectory: stat.isDirectory(),
        size: stat.size,
      };
    });
  }

  _delete(basePath, relPath) {
    const filePath = path.resolve(basePath, relPath || '');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { deleted: true, path: filePath };
  }
}

class HttpBridge extends MicronautBridge {
  constructor(config = {}) {
    super({
      ...config,
      name: config.name || 'http',
      type: 'http',
      capabilities: ['get', 'post', 'put', 'patch', 'delete'],
      metadata: {
        baseUrl: config.baseUrl || 'http://127.0.0.1:8787',
        defaultHeaders: config.defaultHeaders || { 'content-type': 'application/json' },
        timeoutMs: config.timeoutMs || 10000,
        ...(config.metadata || {}),
      },
    });
  }

  async _establishConnection(target = '/') {
    const endpoint = target.startsWith('http') ? target : `${this.metadata.baseUrl}${target}`;
    return { endpoint };
  }

  async _sendMessage(connection, message) {
    const method = (message.method || message.operation || 'GET').toUpperCase();
    const query = message.query || {};
    const body = message.body ?? message.data ?? null;
    const url = new URL(connection.endpoint);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.metadata.timeoutMs);
    try {
      const response = await fetch(url.toString(), {
        method,
        headers: this.metadata.defaultHeaders,
        body: body && method !== 'GET' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let data = text;
      try {
        data = JSON.parse(text);
      } catch {
        // Keep plain text response as-is.
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

class MessageQueueBridge extends MicronautBridge {
  constructor(config = {}) {
    super({
      ...config,
      name: config.name || 'message-queue',
      type: 'message_queue',
      capabilities: ['publish', 'subscribe', 'acknowledge'],
    });
    this._queues = new Map();
  }

  async _establishConnection(target = 'default') {
    const queue = String(target);
    if (!this._queues.has(queue)) this._queues.set(queue, []);
    return { queue };
  }

  async _sendMessage(connection, message) {
    const queueName = connection.queue;
    const queue = this._queues.get(queueName) || [];
    const operation = message.operation || message.op;
    switch (operation) {
      case 'publish': {
        const data = message.data ?? message.payload;
        const record = {
          id: crypto.randomUUID(),
          data,
          timestamp: new Date().toISOString(),
        };
        queue.push(record);
        this._queues.set(queueName, queue);
        return { published: true, queue: queueName, id: record.id };
      }
      case 'subscribe':
        return queue.map((item, index) => ({ ...item, index }));
      case 'acknowledge': {
        const index = Number(message.data?.index ?? message.index);
        if (Number.isInteger(index) && index >= 0 && index < queue.length) {
          queue.splice(index, 1);
        }
        return { acknowledged: true, queue: queueName };
      }
      default:
        throw new Error(`Unknown queue operation: ${operation}`);
    }
  }
}

class BridgeFactory {
  static create(type, config = {}) {
    const map = {
      powernaut: PowernautBridge,
      'powernaut-glsl': PowernautBridge,
      xvm: XvmD3d12Bridge,
      'xvm-d3d12': XvmD3d12Bridge,
      hybrid: HybridClusterGlslBridge,
      'hybrid-cluster-glsl': HybridClusterGlslBridge,
      fs: FileSystemBridge,
      filesystem: FileSystemBridge,
      http: HttpBridge,
      mq: MessageQueueBridge,
      'message-queue': MessageQueueBridge,
      message_queue: MessageQueueBridge,
    };
    const key = String(type || '').toLowerCase();
    const BridgeClass = map[key];
    if (!BridgeClass) {
      throw new Error(`Unknown bridge type: ${type}`);
    }
    return new BridgeClass(config);
  }

  static listTypes() {
    return {
      runtime: ['powernaut-glsl', 'xvm-d3d12', 'hybrid-cluster-glsl'],
      system: ['filesystem', 'http'],
      domain: ['message-queue'],
    };
  }
}

module.exports = {
  MicronautBridge,
  TransportBridge,
  PowernautBridge,
  XvmD3d12Bridge,
  HybridClusterGlslBridge,
  FileSystemBridge,
  HttpBridge,
  MessageQueueBridge,
  BridgeFactory,
  createBridge: (type, config) => BridgeFactory.create(type, config),
};
