// sw.js — Service Worker for KUHUL-ES browser runtime.
//
// Responsibilities:
//   1. Cache the browser manifest, PWA manifest, index.html, and runtime modules.
//   2. Serve cached assets when offline.
//   3. Provide a message channel so the UI can execute KUHUL-ES code even offline.
//   4. Merge the browser + Node code paths by importing the isomorphic core.

'use strict';

import { KUHULRuntimeCore } from './runtime/src/core.mjs';
import { ChatBridge, chatCompletionFetchHandler } from './runtime/src/chat_bridge.mjs';

// Only register service-worker listeners if we are actually in a SW global scope.
// This keeps the file safe to import in Node for syntax checking / bundling.
const isServiceWorker = typeof self !== 'undefined' && typeof importScripts === 'function';

const CACHE_NAME = 'kuhul-es-v1.6.0';

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
  './runtime/src/kxml_chat.mjs',
  './runtime/src/chat_bridge.mjs',
  './runtime/src/think.mjs',
  './runtime/src/pattern_reasoner.mjs',
  './runtime/src/glsl_kernels.js',
  './compiler/src/parser.js',
  './compiler/src/driver-kast.js',
  './kxml/nodes.json',
  './kxml/alignment.json',
  './kxml/chat_template.json',
  './kxml/chat_template.jinja',
];

// Try to load an optional PCRE2 WASM runtime. ServiceWorkerGlobalScope
// disallows dynamic import() (https://github.com/w3c/ServiceWorker/issues/1356),
// so in the SW we skip dynamic loading and let the pattern reasoner fall back to
// native RegExp. The UI thread can still load PCRE2 via import() in index.html.
let __PCRE2_STATUS = { ok: false, source: null, ready: false };

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
  // Dynamic import() is not permitted inside a service worker.
  // Keep status false and rely on native RegExp fallback.
  console.log('[SW] PCRE2 dynamic import skipped in ServiceWorker scope; using native RegExp fallback');
  __PCRE2_STATUS = { ok: false, source: null, ready: false };
  await broadcastPcre2Status();
  return { ok: false };
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
if (isServiceWorker) {
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

  // ── Fetch handler: chat completions are handled by the semantic bridge ─────
  const chatBridge = new ChatBridge({ timeoutMs: 500 });

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Intercept OpenAI-style chat completion requests locally.
    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      chatCompletionFetchHandler(event, chatBridge);
      return;
    }

    // Otherwise cache-first with network fallback + cache update.
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
    const { type, payload, id, ok, source, ready, fromPage } = event.data || {};

    // Health query for PCRE2 availability
    if (type === 'PCRE2_QUERY') {
      try {
        event.source.postMessage({ type: 'PCRE2_STATUS', ok: __PCRE2_STATUS.ok, source: __PCRE2_STATUS.source, ready: __PCRE2_STATUS.ready });
      } catch (e) { /* ignore */ }
      return;
    }

    // Page reports that it loaded PCRE2. Store status and re-broadcast to clients.
    if (type === 'PCRE2_STATUS' && fromPage) {
      __PCRE2_STATUS = { ok: !!ok, source: source || null, ready: !!ready };
      try {
        await broadcastPcre2Status();
      } catch (e) { /* ignore */ }
      return;
    }

    if (type === 'KUHUL_SET_TOOLS') {
      chatBridge.setTools(payload.tools || []);
      try {
        event.source.postMessage({ type: 'KUHUL_TOOLS_SET', id });
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
} // end isServiceWorker guard
