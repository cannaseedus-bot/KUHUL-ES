// K'UHUL FoldEngine — TypeScript reference implementation
// FOLD AXIS = vertical / semantic depth
// NODE AXIS = horizontal / linear execution
// Minimal EventEmitter — works in Node (CJS/ESM) and browser without deps
class EventEmitter {
    _events = new Map();
    on(event, listener) {
        if (!this._events.has(event))
            this._events.set(event, []);
        this._events.get(event).push(listener);
        return this;
    }
    once(event, listener) {
        const wrapper = (payload) => {
            this.off(event, wrapper);
            listener(payload);
        };
        return this.on(event, wrapper);
    }
    off(event, listener) {
        const list = this._events.get(event);
        if (!list)
            return this;
        const idx = list.indexOf(listener);
        if (idx >= 0)
            list.splice(idx, 1);
        return this;
    }
    emit(event, payload) {
        const list = this._events.get(event);
        if (!list || list.length === 0)
            return false;
        for (const listener of list.slice()) {
            try {
                listener(payload);
            }
            catch (err) {
                // swallow listener errors to keep engine deterministic
            }
        }
        return true;
    }
    listenerCount(event) {
        return this._events.get(event)?.length ?? 0;
    }
}
export class FoldEngine extends EventEmitter {
    _folds = new Map();
    _entryFold = null;
    _options;
    _locked = false;
    constructor(opts = {}) {
        super();
        this._options = {
            maxDepth: opts.maxDepth ?? 32,
            maxNodes: opts.maxNodes ?? 1_000_000,
            memoryThreshold: opts.memoryThreshold ?? 0,
            physics: opts.physics ?? null,
        };
    }
    get entryFold() {
        return this._entryFold;
    }
    get foldIds() {
        return Array.from(this._folds.keys());
    }
    get expandedFoldIds() {
        return this._foldsToArray()
            .filter(e => e.phase === 'expanded' || e.phase === 'expanding')
            .map(e => e.fold.id);
    }
    get totalNodes() {
        let sum = 0;
        for (const e of this._folds.values())
            sum += e.fold.nodes.length;
        return sum;
    }
    status() {
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
    _foldsToArray() {
        return Array.from(this._folds.values());
    }
    _schemaState(phase) {
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
    _phaseFromSchema(state) {
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
    _deriveDepth(parentId) {
        if (!parentId)
            return 0;
        const parent = this._folds.get(parentId);
        return parent ? parent.fold.depth + 1 : 0;
    }
    _checkMemory() {
        const threshold = this._options.memoryThreshold;
        if (threshold > 0 && this.totalNodes >= threshold) {
            this._locked = true;
        }
    }
    registerFold(fold) {
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
        const runtime = {
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
            if (parent)
                parent.children.push(fold.id);
        }
        else if (!this._entryFold) {
            this._entryFold = fold.id;
        }
        this._folds.set(fold.id, runtime);
        this.emit('fold:registered', { fold: runtime.fold, depth });
        this._checkMemory();
        return this;
    }
    admit(foldId, reason = 'explicit', context) {
        return this.unfold(foldId, reason, context);
    }
    unfold(foldId, reason = 'explicit', context) {
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
        const rule = entry.fold.unfolds.find(u => u.target) ?? { target: null, gate: 'explicit' };
        const event = {
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
    collapse(foldId, reason = 'explicit') {
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
        const event = { type: 'fold:collapsed', foldId, reason };
        this.emit('fold:collapsed', event);
        return true;
    }
    exec(foldId, fn) {
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
        }
        catch (err) {
            this.emit('error', err);
            return undefined;
        }
        finally {
            if (entry.fold.state === 'executing') {
                entry.fold.state = 'unfolded';
            }
        }
    }
    runAsync(foldId, fn) {
        const entry = this._folds.get(foldId);
        if (!entry) {
            this.emit('error', new Error(`Unknown fold ${foldId}`));
            return this;
        }
        entry.latentQueue.push(fn);
        return this;
    }
    async drainLatent(foldId) {
        const ids = foldId ? [foldId] : this.foldIds;
        for (const id of ids) {
            const entry = this._folds.get(id);
            if (!entry)
                continue;
            while (entry.latentQueue.length > 0) {
                const fn = entry.latentQueue.shift();
                try {
                    await fn();
                }
                catch (err) {
                    this.emit('error', err);
                }
            }
        }
    }
    commit(foldId) {
        const entry = this._folds.get(foldId);
        if (!entry)
            return false;
        if (entry.phase !== 'expanded')
            return false;
        entry.committed = true;
        entry.fold.state = 'committed';
        this.emit('fold:committed', { foldId, nodes: entry.fold.nodes.length });
        return true;
    }
    _updatePhysics(foldId, delta) {
        if (!this._options.physics)
            return;
        const base = this._options.physics;
        const update = {
            foldId,
            entropy: (base.entropy ?? 0) + (delta.entropy ?? 0),
            gravity: (base.gravity ?? 0) + (delta.gravity ?? 0),
            attention: (base.attention ?? 0) + (delta.attention ?? 0),
        };
        if (base.update)
            base.update(foldId, update);
        this.emit('physics:update', { fold: this._folds.get(foldId)?.fold, update });
    }
    getFold(foldId) {
        return this._folds.get(foldId)?.fold;
    }
    toJSON() {
        const folds = [];
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
    static fromJSON(json) {
        const engine = new FoldEngine();
        for (const fold of json.folds) {
            engine.registerFold(fold);
        }
        engine._entryFold = json.entry_fold || null;
        return engine;
    }
    toKast() {
        const nodes = [];
        const edges = [];
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
    _semanticHash(folds) {
        // Deterministic, non-cryptographic hash of fold topology
        let h = 0;
        const s = JSON.stringify(folds, Object.keys(folds).sort());
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }
}
