// test/pwa_assets.test.js — verify PWA assets and service worker precache list
// Run: npm test

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('PWA assets', () => {
  it('has index.html referencing the manifest and service worker', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /manifest\.webmanifest/);
    assert.match(html, /sw\.js/);
    assert.match(html, /KUHUL-ES Runtime/);
  });

  it('has a valid manifest.webmanifest', () => {
    const raw = fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8');
    const man = JSON.parse(raw);
    assert.equal(man.short_name, 'kuhul-es');
    assert.equal(man.display, 'standalone');
    assert.ok(Array.isArray(man.icons));
  });

  it('has browser.manifest.json with service_worker metadata', () => {
    const raw = fs.readFileSync(path.join(ROOT, 'browser.manifest.json'), 'utf8');
    const man = JSON.parse(raw);
    assert.ok(man.entry_points.service_worker, 'service_worker entry point declared');
    assert.ok(man.service_worker, 'service_worker section exists');
    assert.equal(man.service_worker.path, 'sw.js');
    assert.ok(man.files.required.includes('sw.js'));
    assert.ok(man.files.required.includes('index.html'));
    assert.ok(man.files.required.includes('runtime/src/core.js'));
  });

  it('service worker precache list resolves to existing files', () => {
    // Read the sw.js source and extract the PRECACHE_ASSETS array.
    const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const match = swSrc.match(/const\s+PRECACHE_ASSETS\s+=\s+\[([^\]]*)\]/s);
    assert.ok(match, 'PRECACHE_ASSETS found in sw.js');
    const items = match[1]
      .split('\n')
      .map((line) => {
        const m = line.match(/'\.\/([^']+)'/);
        return m ? m[1] : null;
      })
      .filter(Boolean);

    assert.ok(items.length > 0, 'precache list is non-empty');
    for (const item of items) {
      const p = path.join(ROOT, item);
      assert.ok(fs.existsSync(p), `precache asset missing: ${item}`);
    }
  });
});
