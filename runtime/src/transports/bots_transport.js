// runtime/src/transports/bots_transport.js
//
// Transport adapter that routes fold phase dispatch to bots.py JSONL subprocess.
// Model backends (C:\Users\canna\.models):
//
//   Pop / Wo / Yax / Ch'en  →  gemma        (Gemma 3 1B QAT-Q4 — key grammar words,
//                                             questions, and vectors; light + accurate)
//   Sek / Xul               →  qwen         (Qwen3 1.7B-Q8 / 4B-Q8 — heavy lifting,
//                                             complex generation and final answer)
//
// EmbeddingGemma 2 (HuggingFace hub) is the embedding backend for semantic scoring
// (S(g,c) in ConceptFieldAccumulator) — called via gemma_embed task, not phase-routed.
// Native inference drivers: qwen_infer_driver.dll, DirectML.dll, d3d11_infer.dll,
// gl_infer_driver.dll (C:\Users\canna\.micronaut_daemon\drivers\).
//
// bots.py is spawned once as a persistent JSONL process; requests are serialised
// through a promise queue so concurrent fold phases don't interleave.

'use strict';

const { spawn } = require('child_process');
const path      = require('path');

// Phase → bots task mapping (overridable via opts.phaseMap)
const DEFAULT_PHASE_MAP = {
  Pop:    'gemma',   // perceive — Gemma 3 1B: corpus entry, key grammar words
  Wo:     'gemma',   // plan — Gemma 3 1B: questions, word vectors, tool intake
  Yax:    'gemma',   // validate — Gemma 3 1B: field expansion, evidence branching
  Sek:    'qwen',    // generate — Qwen3: heavy lifting, proposal generation
  "Ch'en": 'gemma', // verify — Gemma 3 1B: accurate verification, key grammar
  Chen:   'gemma',
  Xul:    'qwen',    // commit — Qwen3: heavy lifting, final answer generation
};

function botsTransport(opts = {}) {
  const pythonBin  = opts.python  || 'python';
  const botsPath   = opts.botsPath
    || path.join(__dirname, '..', '..', '..', '..', 'micronaut-factory', 'bots.py');
  const phaseMap   = Object.assign({}, DEFAULT_PHASE_MAP, opts.phaseMap || {});
  const timeoutMs  = opts.timeoutMs || 60000;

  let proc         = null;    // child process
  let buf          = '';      // stdout line buffer
  let pendingQueue = [];      // [{resolve, reject, timer}]
  let starting     = false;
  let startWaiters = [];

  // ── subprocess lifecycle ──────────────────────────────────────────────────

  function _ensureProc() {
    if (proc) return Promise.resolve();
    if (starting) return new Promise((res, rej) => startWaiters.push({ res, rej }));
    starting = true;
    return new Promise((resolve, reject) => {
      const child = spawn(pythonBin, [botsPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stderr.on('data', () => {}); // swallow model-loader noise

      child.stdout.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const waiter = pendingQueue.shift();
          if (!waiter) continue;
          clearTimeout(waiter.timer);
          try {
            waiter.resolve(JSON.parse(line));
          } catch {
            waiter.resolve({ ok: false, raw: line });
          }
        }
      });

      child.on('error', (e) => {
        if (starting) {
          starting = false;
          startWaiters.forEach(w => w.rej(e));
          startWaiters = [];
          reject(e);
        }
        pendingQueue.forEach(w => { clearTimeout(w.timer); w.reject(e); });
        pendingQueue = [];
        proc = null;
      });

      child.on('close', () => {
        proc = null;
        pendingQueue.forEach(w => { clearTimeout(w.timer); w.reject(new Error('bots.py exited')); });
        pendingQueue = [];
      });

      proc = child;
      starting = false;
      startWaiters.forEach(w => w.res());
      startWaiters = [];
      resolve();
    });
  }

  function _send(task, payload) {
    return _ensureProc().then(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = pendingQueue.findIndex(w => w.resolve === resolve);
        if (idx !== -1) pendingQueue.splice(idx, 1);
        reject(new Error(`bots.py timeout on task=${task}`));
      }, timeoutMs);
      pendingQueue.push({ resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ task, payload }) + '\n');
    }));
  }

  // ── phase routing ─────────────────────────────────────────────────────────

  function _phaseToTask(phase, dispatchHint) {
    if (dispatchHint) return dispatchHint;
    return phaseMap[phase] || 'mini_chat';
  }

  // ── transport function ────────────────────────────────────────────────────

  return async function transport(op, payload) {

    if (op === 'health') {
      try {
        const r = await _send('health', {});
        return { ok: true, data: r };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    if (op === 'dispatch') {
      // payload shape:
      //   phase       — fold phase string ('Pop', 'Sek', …)
      //   task        — override bots task directly (optional)
      //   prompt      — text for mini_chat / gemma
      //   question    — user question for tool-read or gemma
      //   tools_json  — JSON string of tool descriptors (for mini_tool_read)
      //   tool_call   — <tool_call>…</tool_call> string (for mini_tool_read)
      //   tool_response — <tool_response>…</tool_response> string
      //   adapter_path — path to micronaut adapter JSON (for mini_meta lookup)
      //   max_tokens  — optional
      //   temperature — optional

      const phase    = payload.phase || 'Sek';
      const botTask  = _phaseToTask(phase, payload.task);

      let botsPayload;
      let botsTask;
      if (botTask === 'qwen') {
        // Qwen3 — heavy lifting: proposal generation (Sek) and final answer (Xul)
        botsTask = 'qwen_complete';
        botsPayload = {
          prompt:      payload.prompt || payload.question || '',
          max_tokens:  payload.max_tokens || 256,
          temperature: payload.temperature || 0.6,
          top_k:       payload.top_k || 40,
        };
      } else if (botTask === 'gemma') {
        // Gemma 3 1B — key grammar words, questions, vectors, verification
        botsTask = 'gemma_complete';
        botsPayload = { prompt: payload.prompt || payload.question || '' };
      } else if (botTask === 'gemma_embed') {
        // EmbeddingGemma 2 — semantic scoring S(g,c) for ConceptFieldAccumulator
        botsTask = 'gemma_embed';
        botsPayload = { text: payload.text || payload.prompt || '' };
      } else {
        // pass-through for explicit task override
        botsTask = botTask;
        botsPayload = payload;
      }

      try {
        const r = await _send(botsTask, botsPayload);
        // fire-and-forget: log this semantic exchange to jrom-micronaut/temp/semantic_replay.jsonl
        _send('semantic_log', { entry: {
          kind:   'fold_dispatch',
          phase,
          model:  botsTask,
          input:  (botsPayload.prompt || botsPayload.question || '').slice(0, 300),
          output: (r?.answer || r?.text || '').slice(0, 300),
        }}).catch(() => {});
        return { ok: true, phase, model: botsTask, data: r };
      } catch (e) {
        return { ok: false, phase, model: botsTask, error: e.message };
      }
    }

    if (op === 'meta') {
      // Fetch a micronaut's tool list + shared weight paths
      try {
        const r = await _send('mini_meta', { adapter_path: payload?.adapter_path || '' });
        return { ok: true, data: r };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    if (op === 'shutdown') {
      if (proc) { try { proc.stdin.end(); } catch {} }
      return { ok: true };
    }

    return { ok: false, error: `unknown bots transport op: ${op}` };
  };
}

module.exports = {
  botsTransport,
  DEFAULT_PHASE_MAP,
};
