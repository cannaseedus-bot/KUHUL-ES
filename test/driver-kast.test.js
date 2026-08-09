// test/driver-kast.test.js — driver-only KAST admission surface tests
// Run: npm test

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KUHULParser, toKast } = require('../compiler/src/parser.js');
const {
  toDriverOnly, verifyDriverOnly, canonicalJson,
  DriverRegistry, generateProviderKeypair, signDriver, auditEntry,
} = require('../compiler/src/driver-kast.js');

const SRC = `pi provider = 'kuhul-glsl';
pi capabilities = ['shader.compile', 'shader.compute', 'tensor.matmul'];
function* main() {
  yield* Pop('init');
  yield* Sek('log', 'x');
  yield* Xul();
}
main();`;

function fullKast() {
  const prog = new KUHULParser(SRC, 'd.kuhules').parse();
  return toKast(prog, 'd.kuhules', { driver: true });
}

test('driver-only strips all application nodes/edges', () => {
  const dk = toDriverOnly(fullKast());
  assert.equal(dk.kind, 'driver-only');
  assert.equal(dk.protocol, 'kast/1');
  assert.ok(!('nodes' in dk), 'nodes must be stripped');
  assert.ok(!('edges' in dk), 'edges must be stripped');
  assert.equal(dk['@driver']['@provider'], 'kuhul-glsl');
  assert.ok(dk['@admission'].allowed_opcodes.length > 0);
});

test('admission derives least-privilege allowlists from actual usage', () => {
  const dk = toDriverOnly(fullKast());
  // PROBE (Pop), DISPATCH (Sek), COMMIT (Xul) — from the actual glyph calls
  assert.ok(dk['@admission'].allowed_opcodes.includes('PROBE'));
  assert.ok(dk['@admission'].allowed_opcodes.includes('DISPATCH'));
  assert.ok(dk['@admission'].allowed_opcodes.includes('COMMIT'));
  assert.ok(dk['@admission'].allowed_folds.includes('Pop'));
  assert.ok(dk['@admission'].allowed_folds.includes('Xul'));
});

test('verifyDriverOnly admits matching caps', () => {
  const dk = toDriverOnly(fullKast());
  const r = verifyDriverOnly(dk, {
    abi: 1,
    capabilities: ['shader.compile', 'shader.compute', 'tensor.matmul'],
    maxNodes: 2000, maxMemory: 2048,
    providerWhitelist: ['kuhul-glsl'],
  });
  assert.equal(r.admitted, true);
});

test('verifyDriverOnly rejects missing capability', () => {
  const dk = toDriverOnly(fullKast());
  const r = verifyDriverOnly(dk, { abi: 1, capabilities: ['tensor.map'] });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /Missing capability/);
});

test('verifyDriverOnly rejects ABI mismatch', () => {
  const dk = toDriverOnly(fullKast());
  const r = verifyDriverOnly(dk, { abi: 2, capabilities: ['shader.compile', 'shader.compute', 'tensor.matmul'] });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /ABI mismatch/);
});

test('verifyDriverOnly rejects provider outside whitelist', () => {
  const dk = toDriverOnly(fullKast());
  const r = verifyDriverOnly(dk, {
    abi: 1, capabilities: ['shader.compile', 'shader.compute', 'tensor.matmul'],
    providerWhitelist: ['trusted-only'],
  });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /not in whitelist/);
});

test('verifyDriverOnly rejects resource-limit breach', () => {
  const dk = toDriverOnly(fullKast(), { resourceLimits: { maxNodes: 10000 } });
  const r = verifyDriverOnly(dk, { abi: 1, capabilities: ['shader.compile', 'shader.compute', 'tensor.matmul'], maxNodes: 500 });
  assert.equal(r.admitted, false);
  assert.match(r.reason, /exceeds limit/);
});

test('verifyDriverOnly rejects tampered contract (hash)', () => {
  const dk = toDriverOnly(fullKast());
  dk['@driver']['@capabilities'] = ['evil.escape'];
  const r = verifyDriverOnly(dk, { abi: 1, capabilities: ['shader.compile', 'shader.compute', 'tensor.matmul'] });
  assert.equal(r.admitted, false);
});

test('registry: signed driver admits, tamper rejected', () => {
  const dk = toDriverOnly(fullKast());
  const { publicKey, privateKey } = generateProviderKeypair();
  const reg = new DriverRegistry().register('kuhul-glsl', {
    publicKey, abi: 1, capabilities: ['shader.compile', 'shader.compute', 'tensor.matmul'],
  });
  signDriver(dk, privateKey);
  assert.equal(reg.verify(dk).admitted, true);
  // tamper phase hook -> signature + hash both catch it
  dk['@driver']['@phase_hooks']['Sek'] = 'evil';
  assert.equal(reg.verify(dk).admitted, false);
});

test('audit entry records admission decision + hash', () => {
  const dk = toDriverOnly(fullKast());
  const a = auditEntry(dk, { admitted: true }, { request_id: 'req-1' });
  assert.equal(a.provider, 'kuhul-glsl');
  assert.equal(a.admission_result, true);
  assert.equal(a.request_id, 'req-1');
  assert.equal(a.contract_hash, dk['@driver']['@hash']);
});

test('canonicalJson matches python sort_keys separators', () => {
  const obj = { b: [1, 2], a: { z: 1, y: 'x' } };
  const s = canonicalJson(obj);
  assert.equal(s, '{"a": {"y": "x", "z": 1}, "b": [1, 2]}');
});
