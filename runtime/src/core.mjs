// runtime/src/core.mjs
// Lightweight ESM browser/service-worker compatible runtime core.

import { RuntimeParser } from './runtime_parser.mjs';
import { ExpressionEvaluator } from './expression_evaluator.mjs';
import { KuhulPhysics } from './physics.mjs';
import { KuhulThinkEngine } from './think.mjs';
import { FoldEngine } from './fold-engine.mjs';

const DEFAULT_GLYPHS = ['Sek', 'Pop', 'Wo', "Ch'en", 'Yax', 'Xul', 'Noj'];

async function hashState(state) {
  const str = JSON.stringify(state);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16).padStart(16, '0');
}

class KUHULRuntimeCore {
  constructor(opts = {}) {
    this.π = new Map();
    this.τ = new Map();
    this.τHistory = new Map();
    this.glyphQueue = [];
    this.frame = 0;
    this.hashChain = [];
    this.world = { bodies: [], fields: [], active: true };

    this.eventHandlers = new Map();
    this.outputStream = opts.outputStream || null;
    this.delayMs = opts.delayMs ?? 16;

    this.physics = new KuhulPhysics();
    this.thinker = new KuhulThinkEngine(opts.thinkerOpts || {});

    // Fold engine (lazy semantic expansion)
    try {
      this.foldEngine = new FoldEngine({ physics: this.physics, maxDepth: opts.maxFoldDepth || 32 });
    } catch (e) {
      this.foldEngine = null;
    }

    this._glyphImpl = {
      Sek: this._executeSek.bind(this),
      Pop: this._executePop.bind(this),
      Wo: this._executeWo.bind(this),
      "Ch'en": this._executeChen.bind(this),
      Yax: this._executeYax.bind(this),
      Xul: this._executeXul.bind(this),
      Noj: this._executeNoj.bind(this),
    };

    if (opts.glyphOverrides) {
      for (const [k, v] of Object.entries(opts.glyphOverrides)) {
        this._glyphImpl[k] = typeof v === 'function' ? v.bind(this) : v;
      }
    }
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    for (const h of handlers) try { h(data); } catch (e) { this._log(`event error: ${e.message}`); }
  }

  _log(msg) {
    const line = `[KUHUL] ${msg}`;
    if (this.outputStream && typeof this.outputStream.write === 'function') {
      this.outputStream.write(line + '\n');
    } else if (typeof console !== 'undefined' && console.log) {
      console.log(line);
    }
  }

  async execute(source) {
    try {
      this.parseBindings(source);
      this.parseGlyphCalls(source);
      await this.executeQueue();
      this.emit('complete', { frame: this.frame, hashChain: this.hashChain, πBindings: this.π.size, τBindings: this.τ.size, thoughtCount: this.thinker.thoughts.length });
      this._log(`✓ Execution complete. Frame: ${this.frame}, Hash chain length: ${this.hashChain.length}`);
    } catch (error) {
      this.emit('error', error);
      this._log(`✗ Execution error: ${error.message}`);
      throw error;
    }
  }

  parseBindings(source) {
    const parser = new RuntimeParser(source, 'runtime.kuhules');
    this.runtimeParser = parser;
    const ctx = { π: this.π, τ: this.τ, locals: new Map() };
    const bindings = parser.extractBindings(ctx);

    for (const [name, value] of bindings.π) this.π.set(name, value);
    for (const [name, value] of bindings.τ) { this.τ.set(name, value); if (!this.τHistory.has(name)) this.τHistory.set(name, []); }

    this._log(`Parsed ${this.π.size} π-bindings and ${this.τ.size} τ-bindings (AST-based)`);
    this.emit('stat_update', { piBindings: this.π.size, tauBindings: this.τ.size });
  }

  parseGlyphCalls(source) {
    const parser = this.runtimeParser || new RuntimeParser(source, 'runtime.kuhules');
    const ctx = { π: this.π, τ: this.τ, locals: new Map() };
    this.glyphQueue = parser.extractGlyphCalls(ctx);
    this._log(`Queued ${this.glyphQueue.length} glyph calls (AST-based)`);
  }

  async executeQueue() {
    for (const call of this.glyphQueue) {
      const result = await this.executeGlyph(call.glyph, call.args);
      if (result && result.updateTau) {
        for (const [key, value] of Object.entries(result.updateTau)) {
          if (this.τ.has(key)) {
            this.τHistory.get(key).push({ frame: this.frame, value, hash: await hashState({ value }) });
            this.τ.set(key, value);
          }
        }
      }
      const stateHash = await hashState({ frame: this.frame, glyph: call.glyph, args: call.args, result, physics: this.physics.history[this.physics.history.length - 1] || null });
      this.hashChain.push(stateHash);
      this.emit('hash', { frame: this.frame, hash: stateHash });
      this.frame++;
      this.emit('frame_update', this.frame);
      if (this.delayMs > 0) await new Promise(r => setTimeout(r, this.delayMs));
    }
  }

  async executeGlyph(glyph, args) {
    const impl = this._glyphImpl[glyph];
    if (!impl) { this._log(`Unknown glyph: ${glyph}`); return null; }
    return await impl(...args);
  }

  async _executeSek(operation, ...args) {
    this._log(`[Sek] ${operation}: ${JSON.stringify(args)}`);
    this.physics.execute();
    switch (operation) {
      case 'log': this.emit('log', args.join(' ')); return { logged: true, message: args.join(' ') };
      case 'set': return { updateTau: { [args[0]]: args[1] } };
      case 'think': return await this._executeNoj(args[0], args[1] || {});
      default: return { operation, args };
    }
  }

  async _executePop(value) { this._log(`[Pop] ${value}`); this.physics.perceive(); this.emit('log', `[Pop] ${value}`); return { value }; }
  async _executeWo(op, ...args) { this._log(`[Wo] ${op}: ${JSON.stringify(args)}`); this.physics.represent(); this.emit('log', `[Wo] ${op}`); return { op, args }; }
  async _executeChen(source, ...args) { this._log(`[Ch'en] ${source}: ${JSON.stringify(args)}`); this.physics.project(); this.emit('log', `[Ch'en] ${source}`); return { source, args, timestamp: Date.now() }; }
  async _executeYax(condition, value) { this._log(`[Yax] Condition: ${condition}, Value: ${value}`); this.physics.plan(); const result = condition ? value : null; return { condition, value: result }; }
  async _executeXul() { this._log('[Xul] Stopping execution'); this.physics.consolidate(); this.world.active = false; return { stopped: true, physics: this.physics.state() }; }

  async _executeNoj(query, opts = {}) {
    this._log(`[Noj] Thinking about: ${query}`);
    this.physics.reflect();
    if (opts.observe) {
      const state = this.physics.state();
      this.thinker.learnBelief(`metric:entropy=${state.entropy.toFixed(3)}`, 'Pop', 0.95, 'physics');
      this.thinker.learnBelief(`metric:gravity=${state.gravity.toFixed(3)}`, 'Pop', 0.95, 'physics');
      this.thinker.learnBelief(`metric:attention=${state.attention.toFixed(3)}`, 'Pop', 0.95, 'physics');
    }
    const session = await this.thinker.think(query, opts);
    this.emit('thoughts', session.thoughts);
    return { glyph: 'Noj', query, thoughtCount: session.thoughts.length, thoughts: session.thoughts, hash: session.hash, stats: session.stats };
  }

  async saveState() { return { π: Object.fromEntries(this.π), τ: Object.fromEntries(this.τ), τHistory: Object.fromEntries(this.τHistory), frame: this.frame, hashChain: this.hashChain, world: this.world }; }
  async loadState(state) { this.π = new Map(Object.entries(state.π || {})); this.τ = new Map(Object.entries(state.τ || {})); this.τHistory = new Map(Object.entries(state.τHistory || {})); this.frame = state.frame || 0; this.hashChain = state.hashChain || []; this.world = state.world || { bodies: [], fields: [], active: true }; }
}

export { KUHULRuntimeCore, hashState, DEFAULT_GLYPHS };
