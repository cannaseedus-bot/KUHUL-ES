// kuhul-es/compiler/src/driver-kast.js
//
// Driver-Only KAST: the secure admission surface.
//
// Extracts the @driver contract + admission rules from a full application
// KAST, stripping ALL application nodes/edges. The sandbox mounts only the
// declared capabilities and executes ONLY through the declared phase hooks.
//
// Security properties:
//   1. Separation of concerns   — application (what) vs driver (how)
//   2. Minimum privilege        — allowed glyphs/opcodes/folds derived from
//                                  actual usage (least privilege)
//   3. Tamper resistance        — sha256 over the canonical contract
//   4. Resource isolation       — @admission limits (nodes, edges, memory,
//                                  workgroup, dispatch)
//   5. Provider whitelisting    — verify against runtime provider whitelist
//   6. Capability filtering     — runtime rejects unsupported capabilities
//
// Cross-language: npm side emits the driver-only KAST; the Python/khlc side
// (drivers/khl/*.khl) provides the actual driver implementation. Both speak
// the same canonical JSON (sorted keys, python json.dumps separators).

'use strict';

const crypto = require('crypto');

// Canonical JSON serialization with sorted keys (matches Python
// json.dumps(obj, sort_keys=True) — same bytes as khlc.py/kson_validate.py).
function canonicalJson(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(', ') + ']';
  if (obj !== null && typeof obj === 'object') {
    return '{' + Object.keys(obj).sort().map(k =>
      JSON.stringify(k) + ': ' + canonicalJson(obj[k])).join(', ') + '}';
  }
  return JSON.stringify(obj);
}

// Generate a driver-only KAST from a full application KAST (which must carry
// a @driver contract). Allowed glyphs/opcodes/folds are auto-derived from the
// application's actual node usage — least privilege by construction.
function toDriverOnly(appKast, opts = {}) {
  const driver = appKast && appKast['@driver'];
  if (!driver) {
    throw new Error('Application KAST must contain a @driver contract (compile with --driver)');
  }

  // derive the admission surface from actual usage
  const allGlyphs = new Set();
  const allOpcodes = new Set();
  const folds = new Set();
  if (Array.isArray(appKast.nodes)) {
    for (const n of appKast.nodes) {
      if (n.glyph) allGlyphs.add(n.glyph);
      if (n.opcode) allOpcodes.add(n.opcode);
      if (n.fold) folds.add(n.fold);
    }
  }

  // canonical driver contract (sorted keys -> deterministic hash)
  const contract = {
    '@abi': driver['@abi'] || 1,
    '@requires': driver['@requires'] || { kuhul: '>= 1.0' },
    '@capabilities': driver['@capabilities'] || ['tensor.map'],
    '@phase_hooks': driver['@phase_hooks'] || {
      Sek: 'dispatch',
      "Ch'en": 'collect_status',
      Xul: 'commit_tensor_state',
    },
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

// Verify a driver-only KAST against runtime capabilities.
// Returns { admitted, reason? }.
function verifyDriverOnly(driverKast, runtimeCaps) {
  const driver = driverKast['@driver'];
  const admission = driverKast['@admission'];

  // ABI
  if (driver['@abi'] !== runtimeCaps.abi) {
    return { admitted: false, reason: `ABI mismatch: ${driver['@abi']} != ${runtimeCaps.abi}` };
  }
  // provider whitelist
  if (runtimeCaps.providerWhitelist && !runtimeCaps.providerWhitelist.includes(driver['@provider'])) {
    return { admitted: false, reason: `Provider ${driver['@provider']} not in whitelist` };
  }
  // capabilities
  for (const cap of driver['@capabilities'] || []) {
    if (!runtimeCaps.capabilities.includes(cap)) {
      return { admitted: false, reason: `Missing capability: ${cap}` };
    }
  }
  // resource limits
  if (runtimeCaps.maxNodes && admission.max_nodes > runtimeCaps.maxNodes) {
    return { admitted: false, reason: `Node count ${admission.max_nodes} exceeds limit ${runtimeCaps.maxNodes}` };
  }
  if (runtimeCaps.maxMemory && (admission.resource_limits.max_memory_mb || 0) > runtimeCaps.maxMemory) {
    return { admitted: false, reason: `Memory limit ${admission.resource_limits.max_memory_mb}MB exceeds ${runtimeCaps.maxMemory}MB` };
  }
  // tamper check: recompute hash over the contract (minus hash/signature)
  const contract = { ...driver };
  delete contract['@hash'];
  delete contract['@signature'];
  const computed = crypto.createHash('sha256').update(canonicalJson(contract)).digest('hex');
  if (computed !== driver['@hash']) {
    return { admitted: false, reason: 'Driver contract hash mismatch — possible tampering' };
  }

  return { admitted: true };
}


// ── Driver Registry ─────────────────────────────────────────────────────────
// Maps provider -> public key (Ed25519) + ABI + version + capability matrix.
// The registry is the trust anchor: verifyDriverOnly() checks @signature
// against the provider's registered public key when one is present.
class DriverRegistry {
  constructor(entries = {}) {
    this.entries = entries;   // { provider: { publicKey, abi, version, capabilities[], phaseHooks{} } }
  }

  register(provider, entry) { this.entries[provider] = entry; return this; }

  lookup(provider) { return this.entries[provider] || null; }

  // runtime capability snapshot derived from the registry
  runtimeCapabilities(maxNodes, maxMemory) {
    const caps = new Set();
    for (const e of Object.values(this.entries)) for (const c of e.capabilities || []) caps.add(c);
    return {
      abi: 1,
      capabilities: Array.from(caps),
      providerWhitelist: Object.keys(this.entries),
      maxNodes: maxNodes || 2000,
      maxMemory: maxMemory || 2048,
    };
  }

  verify(driverKast) {
    const provider = driverKast['@driver']['@provider'];
    const entry = this.lookup(provider);
    if (!entry) return { admitted: false, reason: `Provider ${provider} not in registry` };
    const r = verifyDriverOnly(driverKast, this.runtimeCapabilities());
    if (!r.admitted) return r;
    // verify signature when present (Ed25519)
    const sig = driverKast['@driver']['@signature'];
    if (sig) {
      const { publicKey } = entry;
      if (!publicKey) return { admitted: false, reason: `No public key registered for ${provider}` };
      const contract = { ...driverKast['@driver'] };
      delete contract['@hash'];
      delete contract['@signature'];
      let ok = false;
      try {
        ok = crypto.verify(null, Buffer.from(canonicalJson(contract)), publicKey, Buffer.from(sig, 'hex'));
      } catch { ok = false; }
      if (!ok) return { admitted: false, reason: `Signature verification failed for ${provider}` };
    }
    return { admitted: true };
  }
}

// Generate an Ed25519 keypair for a provider (for registry setup).
function generateProviderKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

// Sign a driver-only KAST's contract with an Ed25519 private key.
function signDriver(driverKast, privateKeyPem) {
  const contract = { ...driverKast['@driver'] };
  delete contract['@hash'];
  delete contract['@signature'];
  const sig = crypto.sign(null, Buffer.from(canonicalJson(contract)), privateKeyPem);
  driverKast['@driver']['@signature'] = sig.toString('hex');
  return driverKast;
}

// ── Audit helper ────────────────────────────────────────────────────────────
// The driver-only KAST is the audit record: provider, admission result,
// resource limits, and the contract hash — tamper-evident by construction.
function auditEntry(driverKast, result, meta = {}) {
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

module.exports = {
  canonicalJson,
  toDriverOnly,
  verifyDriverOnly,
  DriverRegistry,
  generateProviderKeypair,
  signDriver,
  auditEntry,
};
