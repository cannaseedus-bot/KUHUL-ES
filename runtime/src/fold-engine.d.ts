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
declare class EventEmitter {
    private _events;
    on(event: string, listener: (payload: unknown) => void): this;
    once(event: string, listener: (payload: unknown) => void): this;
    off(event: string, listener: (payload: unknown) => void): this;
    emit(event: string, payload?: unknown): boolean;
    listenerCount(event: string): number;
}
export declare class FoldEngine extends EventEmitter {
    private _folds;
    private _entryFold;
    private _options;
    private _locked;
    constructor(opts?: FoldEngineOptions);
    get entryFold(): string | null;
    get foldIds(): string[];
    get expandedFoldIds(): string[];
    get totalNodes(): number;
    status(): Record<string, unknown>;
    private _foldsToArray;
    private _schemaState;
    private _phaseFromSchema;
    private _deriveDepth;
    private _checkMemory;
    registerFold(fold: FoldNode): this;
    admit(foldId: string, reason?: string, context?: Record<string, unknown>): boolean;
    unfold(foldId: string, reason?: string, context?: Record<string, unknown>): boolean;
    collapse(foldId: string, reason?: string): boolean;
    exec<T>(foldId: string, fn: (nodes: FoldNodeLinear[]) => T): T | undefined;
    runAsync(foldId: string, fn: () => Promise<void>): this;
    drainLatent(foldId?: string): Promise<void>;
    commit(foldId: string): boolean;
    private _updatePhysics;
    getFold(foldId: string): FoldNode | undefined;
    toJSON(): FoldGraph;
    static fromJSON(json: FoldGraph): FoldEngine;
    toKast(): {
        protocol: 'kast/1';
        nodes: unknown[];
        edges: unknown[];
        folds: FoldGraph;
    };
    private _semanticHash;
}
export {};
