// kuhul-es/compiler/src/driver-kast.ts
//
// Driver-Only KAST: the secure admission surface.
// See driver-kast.js for the full documentation. This is the TypeScript
// source (the package ships the ESM .js artifact).

import crypto from 'node:crypto';

export interface DriverOnlyKAST {
  protocol: 'kast/1';
  kind: 'driver-only';
  '@driver': {
    '@abi': number;
    '@requires': Record<string, string>;
    '@capabilities': string[];
    '@phase_hooks': Record<string, string>;
    '@provider': string;
    '@resources': string[];
    '@hash': string;
    '@signature'?: string;
  };
  '@admission': {
    allowed_glyphs: string[];
    allowed_opcodes: string[];
    allowed_folds: string[];
    max_nodes: number;
    max_edges: number;
    resource_limits: Record<string, number>;
  };
  source_id: string;
  timestamp: string;
}

export function canonicalJson(obj: any): string {
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(', ') + ']';
  if (obj !== null && typeof obj === 'object') {
    return '{' + Object.keys(obj).sort().map(k =>
      JSON.stringify(k) + ': ' + canonicalJson(obj[k])).join(', ') + '}';
  }
  return JSON.stringify(obj);
}

export function toDriverOnly(
  appKast: any,
  opts: {
    provider?: string;
    resourceLimits?: Record<string, number>;
    allowedGlyphs?: string[];
    allowedOpcodes?: string[];
    allowedFolds?: string[];
    sign?: (payload: string) => string;
  } = {}
): DriverOnlyKAST {
  const driver = appKast && appKast['@driver'];
  if (!driver) throw new Error('Application KAST must contain a @driver contract (compile with --driver)');

  const allGlyphs = new Set<string>();
  const allOpcodes = new Set<string>();
  const folds = new Set<string>();
  if (Array.isArray(appKast.nodes)) {
    for (const n of appKast.nodes) {
      if (n.glyph) allGlyphs.add(n.glyph);
      if (n.opcode) allOpcodes.add(n.opcode);
      if (n.fold) folds.add(n.fold);
    }
  }

  const contract = {
    '@abi': driver['@abi'] || 1,
    '@requires': driver['@requires'] || { kuhul: '>= 1.0' },
    '@capabilities': driver['@capabilities'] || ['tensor.map'],
    '@phase_hooks': driver['@phase_hooks'] || { Sek: 'dispatch', "Ch'en": 'collect_status', Xul: 'commit_tensor_state' },
    '@provider': opts.provider || driver['@provider'] || 'kuhul-es',
    '@resources': driver['@resources'] || [],
  };
  const contractJson = canonicalJson(contract);
  const hash = crypto.createHash('sha256').update(contractJson).digest('hex');

  const limits = opts.resourceLimits || {};
  const admission = {
    allowed_glyphs: opts.allowedGlyphs || Array.from(allGlyphs),
    allowed_opcodes: opts.allowedOpcodes || Array.from(allOpcodes),
    allowed_folds: opts.allowedFolds || Array.from(folds),
    max_nodes: limits.maxNodes || 1000,
    max_edges: limits.maxEdges || 1000,
    resource_limits: {
      max_memory_mb: limits.maxMemoryMb || 1024,
      max_compute_units: limits.maxComputeUnits || 100,
      max_workgroup_size: limits.maxWorkgroupSize || 256,
      max_dispatch_size: limits.maxDispatchSize || 65536,
      ...limits,
    },
  };

  return {
    protocol: 'kast/1',
    kind: 'driver-only',
    '@driver': {
      ...contract,
      '@hash': hash,
      ...(opts.sign ? { '@signature': opts.sign(contractJson) } : {}),
    },
    '@admission': admission,
    source_id: appKast.source_id || 'unknown',
    timestamp: new Date().toISOString(),
  };
}

export function verifyDriverOnly(
  driverKast: DriverOnlyKAST,
  runtimeCaps: {
    abi: number;
    capabilities: string[];
    maxNodes?: number;
    maxMemory?: number;
    providerWhitelist?: string[];
  }
): { admitted: boolean; reason?: string } {
  const driver = driverKast['@driver'];
  const admission = driverKast['@admission'];

  if (driver['@abi'] !== runtimeCaps.abi) {
    return { admitted: false, reason: `ABI mismatch: ${driver['@abi']} != ${runtimeCaps.abi}` };
  }
  if (runtimeCaps.providerWhitelist && !runtimeCaps.providerWhitelist.includes(driver['@provider'])) {
    return { admitted: false, reason: `Provider ${driver['@provider']} not in whitelist` };
  }
  for (const cap of driver['@capabilities'] || []) {
    if (!runtimeCaps.capabilities.includes(cap)) {
      return { admitted: false, reason: `Missing capability: ${cap}` };
    }
  }
  if (runtimeCaps.maxNodes && admission.max_nodes > runtimeCaps.maxNodes) {
    return { admitted: false, reason: `Node count ${admission.max_nodes} exceeds limit ${runtimeCaps.maxNodes}` };
  }
  if (runtimeCaps.maxMemory && (admission.resource_limits.max_memory_mb || 0) > runtimeCaps.maxMemory) {
    return { admitted: false, reason: `Memory limit ${admission.resource_limits.max_memory_mb}MB exceeds ${runtimeCaps.maxMemory}MB` };
  }
  const contract = { ...driver };
  delete contract['@hash'];
  delete contract['@signature'];
  const computed = crypto.createHash('sha256').update(canonicalJson(contract)).digest('hex');
  if (computed !== driver['@hash']) {
    return { admitted: false, reason: 'Driver contract hash mismatch — possible tampering' };
  }
  return { admitted: true };
}

// ── Driver Registry (trust anchor) ─────────────────────────────────────────
export class DriverRegistry {
  entries: Record<string, any>;
  constructor(entries: Record<string, any> = {}) { this.entries = entries; }
  register(provider: string, entry: any) { this.entries[provider] = entry; return this; }
  lookup(provider: string) { return this.entries[provider] || null; }
  runtimeCapabilities(maxNodes?: number, maxMemory?: number) {
    const caps = new Set<string>();
    for (const e of Object.values(this.entries)) for (const c of e.capabilities || []) caps.add(c);
    return {
      abi: 1, capabilities: Array.from(caps),
      providerWhitelist: Object.keys(this.entries),
      maxNodes: maxNodes || 2000, maxMemory: maxMemory || 2048,
    };
  }
  verify(driverKast: DriverOnlyKAST): { admitted: boolean; reason?: string } {
    const provider = driverKast['@driver']['@provider'];
    const entry = this.lookup(provider);
    if (!entry) return { admitted: false, reason: `Provider ${provider} not in registry` };
    const r = verifyDriverOnly(driverKast, this.runtimeCapabilities());
    if (!r.admitted) return r;
    const sig = driverKast['@driver']['@signature'];
    if (sig) {
      const { publicKey } = entry;
      if (!publicKey) return { admitted: false, reason: `No public key registered for ${provider}` };
      const contract: any = { ...driverKast['@driver'] };
      delete contract['@hash']; delete contract['@signature'];
      let ok = false;
      try { ok = crypto.verify(null, Buffer.from(canonicalJson(contract)), publicKey, Buffer.from(sig, 'hex')); } catch { ok = false; }
      if (!ok) return { admitted: false, reason: `Signature verification failed for ${provider}` };
    }
    return { admitted: true };
  }
}

export function generateProviderKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

export function signDriver(driverKast: DriverOnlyKAST, privateKeyPem: string): DriverOnlyKAST {
  const contract: any = { ...driverKast['@driver'] };
  delete contract['@hash']; delete contract['@signature'];
  const sig = crypto.sign(null, Buffer.from(canonicalJson(contract)), privateKeyPem);
  driverKast['@driver']['@signature'] = sig.toString('hex');
  return driverKast;
}

export function auditEntry(driverKast: DriverOnlyKAST, result: { admitted: boolean; reason?: string }, meta: Record<string, any> = {}) {
  return {
    timestamp: driverKast.timestamp || new Date().toISOString(),
    source_id: driverKast.source_id,
    provider: driverKast['@driver']['@provider'],
    admission_result: result.admitted,
    admission_reason: result.reason || 'admitted',
    capabilities: driverKast['@driver']['@capabilities'],
    resource_limits: driverKast['@admission'].resource_limits,
    contract_hash: driverKast['@driver']['@hash'],
    signature: driverKast['@driver']['@signature'] || null,
    ...meta,
  };
}
