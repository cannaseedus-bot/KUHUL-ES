// K'UHUL FoldEngine — TypeScript reference implementation
// FOLD AXIS = vertical / semantic depth
// NODE AXIS = horizontal / linear execution

export type GlyphPhase = 'Pop' | 'Wo' | 'Yax' | 'Sek' | "Ch'en" | 'Xul';
export type FoldPhase = 'compressed' | 'expanding' | 'expanded' | 'collapsing' | 'collapsed';
export type FoldSchemaState = 'collapsed' | 'admitted' | 'unfolded' | 'executing' | 'committed';
export type Gate = 'always' | 'capability' | 'pressure' | 'confidence' | 'dependency' | 'explicit';
export type Lane = string;

export interface NodeOperand {
  type?: string;
  value?: unknown;
  ref?: string;
}

export interface FoldNodeLinear {
  id: string;
  index: number;
  axis: 'linear';
  lane: Lane;
  glyph: string;
  opcode: string;
  symbol?: string;
  operands?: unknown[];
  result?: unknown;
  attributes?: Record<string, unknown>;
}

export interface UnfoldRule {
  target: string;
  gate: Gate;
  condition?: unknown;
  ordinal?: number;
}

export interface FoldNode {
  id: string;
  phase: GlyphPhase;
  axis: 'vertical';
  state: FoldSchemaState;
  parent: string | null;
  depth: number;
  nodes: FoldNodeLinear[];
  unfolds: UnfoldRule[];
  attributes?: Record<string, unknown>;
}

export interface FoldGraph {
  protocol: 'kfold/1';
  entry_fold: string;
  folds: FoldNode[];
  semantic_hash?: string;
}

export interface FoldRuntimeEntry {
  fold: FoldNode;
  phase: FoldPhase;
  revealed: boolean;
  executed: boolean;
  committed: boolean;
  children: string[];
  latentQueue: Array<() => Promise<void>>;
}

export interface FoldExpansionEvent {
  type: 'fold:expanded';
  foldId: string;
  parentId: string | null;
  depth: number;
  nodesRevealed: number;
  gate: Gate;
  reason?: string;
  context?: Record<string, unknown>;
}

export interface FoldCollapseEvent {
  type: 'fold:collapsed';
  foldId: string;
  reason?: string;
}

export interface PhysicsUpdate {
  foldId: string;
  entropy: number;
  gravity: number;
  attention: number;
}

export interface FoldEngineOptions {
  maxDepth?: number;
  maxNodes?: number;
  memoryThreshold?: number;
  physics?: {
    entropy?: number;
    gravity?: number;
    attention?: number;
    update?: (id: string, delta: Partial<PhysicsUpdate>) => void;
  } | null;
}

// Minimal EventEmitter — works in Node (CJS/ESM) and browser without deps
class EventEmitter {
  private _events: Map<string, Array<(payload: unknown) => void>> = new Map();

  on(event: string, listener: (payload: unknown) => void): this {
    if (!this._events.has(event)) this._events.set(event, []);
    this._events.get(event)!.push(listener);
    return this;
  }

  once(event: string, listener: (payload: unknown) => void): this {
    const wrapper = (payload: unknown) => {
      this.off(event, wrapper);
      listener(payload);
    };
    return this.on(event, wrapper);
  }

  off(event: string, listener: (payload: unknown) => void): this {
    const list = this._events.get(event);
    if (!list) return this;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
    return this;
  }

  emit(event: string, payload?: unknown): boolean {
    const list = this._events.get(event);
    if (!list || list.length === 0) return false;
    for (const listener of list.slice()) {
      try {
        listener(payload);
      } catch (err) {
        // swallow listener errors to keep engine deterministic
      }
    }
    return true;
  }

  listenerCount(event: string): number {
    return this._events.get(event)?.length ?? 0;
  }
}

export class FoldEngine extends EventEmitter {
  private _folds: Map<string, FoldRuntimeEntry> = new Map();
  private _entryFold: string | null = null;
  private _options: Required<FoldEngineOptions>;
  private _locked = false;

  constructor(opts: FoldEngineOptions = {}) {
    super();
    this._options = {
      maxDepth: opts.maxDepth ?? 32,
      maxNodes: opts.maxNodes ?? 1_000_000,
      memoryThreshold: opts.memoryThreshold ?? 0,
      physics: opts.physics ?? null,
    };
  }

  get entryFold(): string | null {
    return this._entryFold;
  }

  get foldIds(): string[] {
    return Array.from(this._folds.keys());
  }

  get expandedFoldIds(): string[] {
    return this._foldsToArray()
      .filter(e => e.phase === 'expanded' || e.phase === 'expanding')
      .map(e => e.fold.id);
  }

  get totalNodes(): number {
    let sum = 0;
    for (const e of this._folds.values()) sum += e.fold.nodes.length;
    return sum;
  }

  status(): Record<string, unknown> {
    const p = this._options.physics;
    return {
      folds: this._folds.size,
      expanded: this.expandedFoldIds.length,
      nodes: this.totalNodes,
      entropy: p?.entropy ?? 0,
      gravity: p?.gravity ?? 0,
      attention: p?.attention ?? 0,
    };
  }

  private _foldsToArray(): FoldRuntimeEntry[] {
    return Array.from(this._folds.values());
  }

  private _schemaState(phase: FoldPhase): FoldSchemaState {
    switch (phase) {
      case 'compressed':
      case 'collapsed':
        return 'collapsed';
      case 'expanding':
        return 'executing';
      case 'expanded':
        return 'unfolded';
      default:
        return 'collapsed';
    }
  }

  private _phaseFromSchema(state: FoldSchemaState): FoldPhase {
    switch (state) {
      case 'admitted':
      case 'unfolded':
      case 'committed':
        return 'expanded';
      case 'executing':
        return 'expanding';
      case 'collapsed':
      default:
        return 'compressed';
    }
  }

  private _deriveDepth(parentId: string | null): number {
    if (!parentId) return 0;
    const parent = this._folds.get(parentId);
    return parent ? parent.fold.depth + 1 : 0;
  }

  private _checkMemory(): void {
    const threshold = this._options.memoryThreshold;
    if (threshold > 0 && this.totalNodes >= threshold) {
      this._locked = true;
    }
  }

  registerFold(fold: FoldNode): this {
    if (this._locked) {
      this.emit('error', new Error(`FoldEngine locked; cannot register fold ${fold.id}`));
      return this;
    }

    if (this._folds.has(fold.id)) {
      this.emit('error', new Error(`Fold ${fold.id} already registered`));
      return this;
    }

    const depth = this._deriveDepth(fold.parent ?? null);
    if (depth > this._options.maxDepth) {
      this.emit('error', new Error(`Fold ${fold.id} exceeds maxDepth ${this._options.maxDepth}`));
      return this;
    }

    const runtime: FoldRuntimeEntry = {
      fold: { ...fold, depth, nodes: fold.nodes.map((n, i) => ({ ...n, index: i })) },
      phase: this._phaseFromSchema(fold.state),
      revealed: fold.state === 'unfolded' || fold.state === 'executing' || fold.state === 'committed',
      executed: false,
      committed: fold.state === 'committed',
      children: [],
      latentQueue: [],
    };

    if (fold.parent) {
      const parent = this._folds.get(fold.parent);
      if (parent) parent.children.push(fold.id);
    } else if (!this._entryFold) {
      this._entryFold = fold.id;
    }

    this._folds.set(fold.id, runtime);
    this.emit('fold:registered', { fold: runtime.fold, depth });
    this._checkMemory();
    return this;
  }

  admit(foldId: string, reason = 'explicit', context?: Record<string, unknown>): boolean {
    return this.unfold(foldId, reason, context);
  }

  unfold(foldId: string, reason = 'explicit', context?: Record<string, unknown>): boolean {
    if (this._locked) {
      this.emit('error', new Error(`FoldEngine locked; cannot unfold ${foldId}`));
      return false;
    }

    const entry = this._folds.get(foldId);
    if (!entry) {
      this.emit('error', new Error(`Unknown fold ${foldId}`));
      return false;
    }

    if (entry.phase === 'expanded' || entry.phase === 'expanding') {
      return false; // already expanded
    }

    entry.phase = 'expanding';
    entry.fold.state = 'executing';
    this._updatePhysics(foldId, { entropy: +0.1, gravity: -0.05, attention: +0.1 });

    entry.phase = 'expanded';
    entry.revealed = true;
    entry.fold.state = 'unfolded';

    this.emit('nodes:revealed', { fold: entry.fold, nodes: entry.fold.nodes });

    const rule = entry.fold.unfolds.find(u => u.target) ?? { target: null, gate: 'explicit' as Gate };
    const event: FoldExpansionEvent = {
      type: 'fold:expanded',
      foldId,
      parentId: entry.fold.parent,
      depth: entry.fold.depth,
      nodesRevealed: entry.fold.nodes.length,
      gate: rule.gate,
      reason,
      context,
    };
    this.emit('fold:expanded', event);
    this._checkMemory();

    return true;
  }

  collapse(foldId: string, reason = 'explicit'): boolean {
    const entry = this._folds.get(foldId);
    if (!entry) {
      this.emit('error', new Error(`Unknown fold ${foldId}`));
      return false;
    }

    if (entry.phase === 'compressed' || entry.phase === 'collapsed') {
      return false; // already collapsed
    }

    entry.phase = 'collapsing';
    entry.fold.state = 'executing';

    // collapse children first (bottom-up)
    for (const childId of entry.children.slice()) {
      this.collapse(childId, `parent-collapsed:${foldId}`);
    }

    entry.phase = 'collapsed';
    entry.fold.state = 'collapsed';
    entry.revealed = false;

    this._updatePhysics(foldId, { entropy: -0.1, gravity: +0.05, attention: -0.1 });
    const event: FoldCollapseEvent = { type: 'fold:collapsed', foldId, reason };
    this.emit('fold:collapsed', event);
    return true;
  }

  exec<T>(foldId: string, fn: (nodes: FoldNodeLinear[]) => T): T | undefined {
    const entry = this._folds.get(foldId);
    if (!entry) {
      this.emit('error', new Error(`Unknown fold ${foldId}`));
      return undefined;
    }
    if (entry.phase !== 'expanded' && entry.phase !== 'expanding') {
      this.emit('error', new Error(`Fold ${foldId} is not expanded`));
      return undefined;
    }

    entry.fold.state = 'executing';
    try {
      const result = fn(entry.fold.nodes);
      entry.executed = true;
      return result;
    } catch (err) {
      this.emit('error', err);
      return undefined;
    } finally {
      if (entry.fold.state === 'executing') {
        entry.fold.state = 'unfolded';
      }
    }
  }

  runAsync(foldId: string, fn: () => Promise<void>): this {
    const entry = this._folds.get(foldId);
    if (!entry) {
      this.emit('error', new Error(`Unknown fold ${foldId}`));
      return this;
    }
    entry.latentQueue.push(fn);
    return this;
  }

  async drainLatent(foldId?: string): Promise<void> {
    const ids = foldId ? [foldId] : this.foldIds;
    for (const id of ids) {
      const entry = this._folds.get(id);
      if (!entry) continue;
      while (entry.latentQueue.length > 0) {
        const fn = entry.latentQueue.shift()!;
        try {
          await fn();
        } catch (err) {
          this.emit('error', err);
        }
      }
    }
  }

  commit(foldId: string): boolean {
    const entry = this._folds.get(foldId);
    if (!entry) return false;
    if (entry.phase !== 'expanded') return false;
    entry.committed = true;
    entry.fold.state = 'committed';
    this.emit('fold:committed', { foldId, nodes: entry.fold.nodes.length });
    return true;
  }

  private _updatePhysics(foldId: string, delta: Partial<PhysicsUpdate>): void {
    if (!this._options.physics) return;
    const base = this._options.physics;
    const update: PhysicsUpdate = {
      foldId,
      entropy: (base.entropy ?? 0) + (delta.entropy ?? 0),
      gravity: (base.gravity ?? 0) + (delta.gravity ?? 0),
      attention: (base.attention ?? 0) + (delta.attention ?? 0),
    };
    if (base.update) base.update(foldId, update);
    this.emit('physics:update', { fold: this._folds.get(foldId)?.fold, update });
  }

  getFold(foldId: string): FoldNode | undefined {
    return this._folds.get(foldId)?.fold;
  }

  toJSON(): FoldGraph {
    const folds: FoldNode[] = [];
    for (const entry of this._folds.values()) {
      folds.push({ ...entry.fold, state: this._schemaState(entry.phase) });
    }
    return {
      protocol: 'kfold/1',
      entry_fold: this._entryFold ?? (folds[0]?.id || ''),
      folds,
      semantic_hash: this._semanticHash(folds),
    };
  }

  static fromJSON(json: FoldGraph): FoldEngine {
    const engine = new FoldEngine();
    for (const fold of json.folds) {
      engine.registerFold(fold);
    }
    engine._entryFold = json.entry_fold || null;
    return engine;
  }

  toKast(): { protocol: 'kast/1'; nodes: unknown[]; edges: unknown[]; folds: FoldGraph } {
    const nodes: unknown[] = [];
    const edges: unknown[] = [];

    for (const entry of this._folds.values()) {
      nodes.push({
        id: entry.fold.id,
        glyph: entry.fold.phase,
        opcode: 'FOLD',
        fold: entry.fold.id,
        axis: 'vertical',
        depth: entry.fold.depth,
        state: entry.fold.state,
      });

      for (let i = 0; i < entry.fold.nodes.length; i++) {
        const n = entry.fold.nodes[i];
        nodes.push({
          id: n.id,
          glyph: n.glyph,
          opcode: n.opcode,
          fold: entry.fold.id,
          lane: n.lane,
          index: n.index,
          axis: 'linear',
        });
        if (i > 0) {
          edges.push({ from: entry.fold.nodes[i - 1].id, to: n.id, type: 'next' });
        }
      }

      for (const u of entry.fold.unfolds) {
        edges.push({ from: entry.fold.id, to: u.target, type: 'unfold', gate: u.gate });
      }
    }

    return { protocol: 'kast/1', nodes, edges, folds: this.toJSON() };
  }

  private _semanticHash(folds: FoldNode[]): string {
    // Deterministic, non-cryptographic hash of fold topology
    let h = 0;
    const s = JSON.stringify(folds, Object.keys(folds).sort());
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
