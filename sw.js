// sw.js — Service Worker for KUHUL-ES browser runtime.
//
// Responsibilities:
//   1. Cache the browser manifest, PWA manifest, index.html, and runtime modules.
//   2. Serve cached assets when offline.
//   3. Provide a message channel so the UI can execute KUHUL-ES code even offline.
//   4. Merge the browser + Node code paths by importing the isomorphic core.

'use strict';

import { KUHULRuntimeCore } from './runtime/src/core.mjs';

const CACHE_NAME = 'kuhul-es-v1.4.0';

// Essential assets for offline PWA + runtime.
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './browser.manifest.json',
  './manifest.webmanifest',
  './runtime/src/browser.js',
  './runtime/src/core.mjs',
  './pcre2/pcre2.js',
  './pcre2/pcre2.wasm',
  './runtime/src/physics.js',
  './runtime/src/think.js',
  './runtime/src/pattern_reasoner.js',
  './runtime/src/expression_evaluator.js',
  './runtime/src/runtime_parser.js',
  './runtime/src/kxml_driver.js',
  './runtime/src/stb_reader.js',
  './runtime/src/kxml_chat.js',
  './runtime/src/glsl_kernels.js',
  './compiler/src/parser.js',
  './compiler/src/driver-kast.js',
  './kxml/nodes.json',
  './kxml/alignment.json',
  './kxml/chat_template.json',
  './kxml/chat_template.jinja',
];

// Try to dynamically load an optional PCRE2 WASM runtime. The SW will
// attempt to import known module paths (local node_modules or CDN). On
// success the module is attached to globalThis.__PCRE2__ so the pattern
// reasoner can use the faster PCRE2 engine instead of native RegExp.
let __PCRE2_STATUS = { ok: false, source: null };

async function broadcastPcre2Status() {
  try {
    const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
    for (const c of clientsList) {
      try {
        c.postMessage({ type: 'PCRE2_STATUS', ok: __PCRE2_STATUS.ok, source: __PCRE2_STATUS.source, ready: !!__PCRE2_STATUS.ready });
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}

async function tryLoadPcre2() {
  const candidates = [
    './pcre2/pcre2.js',
    './node_modules/@ofjansen/pcre2-wasm/dist/pcre2.js',
    './node_modules/@ofjansen/pcre2-wasm/dist/libpcre2.js',
    'https://unpkg.com/@ofjansen/pcre2-wasm@latest/dist/pcre2.js',
    'https://unpkg.com/@ofjansen/pcre2-wasm@latest/dist/libpcre2.js',
    'https://cdn.jsdelivr.net/npm/@ofjansen/pcre2-wasm@latest/dist/pcre2.js',
    'https://cdn.jsdelivr.net/npm/@ofjansen/pcre2-wasm@latest/dist/libpcre2.js'
  ];

  for (const url of candidates) {
    try {
      const imported = await import(url);
      if (!imported) continue;
      const loader = imported.default || imported;

      // Prefer explicit init function
      if (typeof loader.initPcre2 === 'function') {
        try { await loader.initPcre2(); } catch (e) { /* ignore init errors */ }
      } else if (loader && loader.loaded && typeof loader.loaded.then === 'function') {
        try { await loader.loaded; } catch (e) { /* ignore */ }
      } else if (loader && loader.Module && loader.Module.loaded && typeof loader.Module.loaded.then === 'function') {
        try { await loader.Module.loaded; } catch (e) { /* ignore */ }
      } else if (typeof loader.onRuntimeInitialized === 'function') {
        // some Emscripten loaders set onRuntimeInitialized
        await new Promise((resolve) => { loader.onRuntimeInitialized = resolve; });
      }

      globalThis.__PCRE2__ = loader;
      __PCRE2_STATUS = { ok: true, source: url, ready: true };
      console.log('[SW] PCRE2 loaded from', url);
      await broadcastPcre2Status();
      return { ok: true, source: url };
    } catch (err) {
      console.warn('[SW] PCRE2 import failed:', url, err && err.message ? err.message : err);
    }
  }
  __PCRE2_STATUS = { ok: false, source: null };
  await broadcastPcre2Status();
  return { ok: false };
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(PRECACHE_ASSETS);
    } catch (e) {
      console.warn('[SW] precache failed:', e && e.message ? e.message : e);
    }
    // Attempt to pre-load PCRE2 if available (optional).
    try {
      await tryLoadPcre2();
    } catch (e) {
      console.warn('[SW] tryLoadPcre2 failed:', e && e.message ? e.message : e);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('kuhul-es-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch handler: cache-first with network fallback + cache update ───────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET and opaque/telemetry requests
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          // Last-ditch offline fallback
          if (request.destination === 'document') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
    })
  );
});

// ── Message channel: run KUHUL-ES code inside the worker ────────────────────
self.addEventListener('message', async (event) => {
  const { type, payload, id } = event.data || {};

  // Health query for PCRE2 availability
  if (type === 'PCRE2_QUERY') {
    try {
      event.source.postMessage({ type: 'PCRE2_STATUS', ok: __PCRE2_STATUS.ok, source: __PCRE2_STATUS.source });
    } catch (e) { /* ignore */ }
    return;
  }

  if (type !== 'KUHUL_EXECUTE') return;

  const rt = new KUHULRuntimeCore({ delayMs: 0 });
  let error = null;
  let result = null;
  try {
    await rt.execute(payload.source);
    result = {
      frame: rt.frame,
      hashChain: rt.hashChain,
      thoughts: rt.thinker.thoughts,
      physics: rt.physics.history,
    };
  } catch (e) {
    error = { message: e.message, stack: e.stack };
  }

  event.source.postMessage({
    type: 'KUHUL_RESULT',
    id,
    result,
    error,
  });
});
