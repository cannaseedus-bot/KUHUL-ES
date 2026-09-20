#!/usr/bin/env node
'use strict';

/*
 * KUHUL SERVER
 * Deterministic Runtime Host + WebGL2 trainer orchestration
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const pkg = require('../package.json');

const PORT = Number(process.env.KUHUL_SERVER_PORT || 8776);
const LOG_FILE = path.resolve(process.cwd(), 'kuhul-server.log');

const state = {
  version: pkg.version,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  cwd: process.cwd(),
};

const sessions = new Map();

console.log(`
╔══════════════════════════════════════╗
║        KUHUL SERVER v${pkg.version}           ║
║    Deterministic Runtime Host        ║
╚══════════════════════════════════════╝
`);
console.log('PID:', state.pid);
console.log('CWD:', state.cwd);
console.log('Started:', state.startedAt);
console.log('Port:', PORT);

function writeTrace(event, payload = {}) {
  const trace = {
    event,
    payload,
    timestamp: new Date().toISOString(),
  };
  trace.hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(trace))
    .digest('hex');

  fs.appendFileSync(LOG_FILE, JSON.stringify(trace) + '\n');
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  setCors(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error('request_body_too_large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

function normalizeTokenBins(raw) {
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const out = [];
  for (const value of values) {
    const text = String(value || '');
    const parts = text.split(/[;,]/g);
    for (const part of parts) {
      const p = part.trim();
      if (p) out.push(path.resolve(process.cwd(), p));
    }
  }
  return Array.from(new Set(out));
}

function trainerScriptPath(overridePath) {
  if (overridePath) return path.resolve(process.cwd(), overridePath);
  const candidates = [
    path.resolve(__dirname, '..', 'runtime', 'src', 'webgl2_hf_safetensor_trainer.cjs'),
    path.resolve(__dirname, '..', '..', 'kuhul-runtime-v1', 'trainer', 'webgl2_hf_safetensor_trainer.cjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function kuhulEsCliPath() {
  return path.resolve(__dirname, 'kuhul-es.js');
}

function newSessionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.createHash('sha256')
    .update(`${Date.now()}-${Math.random()}`)
    .digest('hex')
    .slice(0, 16);
}

function sessionSummary(session) {
  return {
    id: session.id,
    status: session.status,
    started_at: session.startedAt,
    ended_at: session.endedAt || null,
    pid: session.pid,
    progress: session.progress,
    result: session.result,
    error: session.error,
  };
}

function emitSessionEvent(session, event, payload = {}) {
  const entry = {
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  session.events.push(entry);
  if (session.events.length > 400) session.events.shift();
  session.lastEvent = entry;
  for (const stream of session.subscribers) {
    stream.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
  writeTrace('trainer.event', { session_id: session.id, ...entry });
}

function closeSessionStreams(session) {
  for (const stream of session.subscribers) {
    stream.end();
  }
  session.subscribers.clear();
}

function parseEventLine(line) {
  const text = line.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.event) return parsed;
  } catch {}
  return { event: 'stdout', message: text };
}

function wireStreamLines(stream, onLine) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) break;
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      onLine(line);
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) onLine(buffer);
  });
}

function startWebgl2Training(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload_required');
  }
  if (!payload.input || !payload.output) {
    throw new Error('input_and_output_required');
  }

  const trainerScript = trainerScriptPath(payload.trainer_script);
  if (!fs.existsSync(trainerScript)) {
    throw new Error('trainer_script_not_found');
  }
  const cliPath = kuhulEsCliPath();
  if (!fs.existsSync(cliPath)) {
    throw new Error('kuhul_es_cli_not_found');
  }

  const args = [
    cliPath,
    'train-webgl2',
    '--input', path.resolve(process.cwd(), String(payload.input)),
    '--output', path.resolve(process.cwd(), String(payload.output)),
    '--train-dim', String(payload.train_dim || 512),
    '--batch', String(payload.batch || 16),
    '--steps', String(payload.steps || 24),
    '--lr', String(payload.lr || 0.0006),
    '--seed', String(payload.seed || 1337),
    '--browser', String(payload.browser || 'auto'),
    '--timeout-ms', String(payload.timeout_ms || 180000),
    '--progress-interval', String(payload.progress_interval || 4),
    '--trainer-script', trainerScript,
    '--json',
  ];
  if (payload.tensor) args.push('--tensor', String(payload.tensor));
  if (payload.xjsl_out) args.push('--xjsl-out', path.resolve(process.cwd(), String(payload.xjsl_out)));
  const tokenBins = normalizeTokenBins(payload.token_bins || payload.token_bin);
  for (const tokenBin of tokenBins) {
    args.push('--token-bin', tokenBin);
  }
  if (payload.progress === false) args.push('--no-progress');

  const id = newSessionId();
  const runCwd = payload.cwd ? path.resolve(process.cwd(), String(payload.cwd)) : process.cwd();
  const child = spawn(process.execPath, args, {
    cwd: runCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const session = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    pid: child.pid,
    cwd: runCwd,
    args,
    child,
    events: [],
    subscribers: new Set(),
    progress: { step: 0, steps: Number(payload.steps || 24), percent: 0 },
    result: null,
    error: null,
    exitCode: null,
  };
  sessions.set(id, session);

  emitSessionEvent(session, 'session_started', {
    pid: session.pid,
    cwd: session.cwd,
    cmd: `${process.execPath} ${args.join(' ')}`,
  });

  wireStreamLines(child.stdout, (line) => {
    const event = parseEventLine(line);
    if (!event) return;
    if (event.event === 'progress') {
      session.progress = {
        step: Number(event.step || 0),
        steps: Number(event.steps || session.progress.steps || 0),
        percent: Number(event.percent || 0),
      };
    } else if (event.event === 'result') {
      session.result = event;
    } else if (event.event === 'error') {
      session.error = event.message || 'trainer_reported_error';
    }
    emitSessionEvent(session, event.event || 'stdout', event);
  });

  wireStreamLines(child.stderr, (line) => {
    const text = line.trim();
    if (!text) return;
    emitSessionEvent(session, 'stderr', { message: text });
  });

  child.on('error', (error) => {
    session.status = 'failed';
    session.error = error.message;
    session.endedAt = new Date().toISOString();
    emitSessionEvent(session, 'process_error', { message: error.message });
    closeSessionStreams(session);
  });

  child.on('close', (code) => {
    session.exitCode = typeof code === 'number' ? code : 1;
    session.endedAt = new Date().toISOString();
    if (session.status === 'running') {
      if (session.exitCode === 0) {
        session.status = 'completed';
      } else {
        session.status = 'failed';
        if (!session.error) session.error = `exit_code_${session.exitCode}`;
      }
    }
    emitSessionEvent(session, 'session_exit', {
      code: session.exitCode,
      status: session.status,
    });
    closeSessionStreams(session);
  });

  writeTrace('trainer.start', {
    session_id: session.id,
    input: payload.input,
    output: payload.output,
    token_bins: tokenBins.length,
  });
  return session;
}

function sessionIdFromPath(prefix, pathname) {
  if (!pathname.startsWith(prefix)) return '';
  const value = pathname.slice(prefix.length);
  return decodeURIComponent(value || '');
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      version: state.version,
      pid: state.pid,
      uptime_s: Math.floor(process.uptime()),
      sessions_running: Array.from(sessions.values()).filter((s) => s.status === 'running').length,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/train/webgl2/start') {
    try {
      const payload = await readJsonBody(req);
      const session = startWebgl2Training(payload);
      sendJson(res, 202, {
        status: 'accepted',
        session: sessionSummary(session),
        status_url: `/v1/train/webgl2/status/${encodeURIComponent(session.id)}`,
        events_url: `/v1/train/webgl2/events/${encodeURIComponent(session.id)}`,
        stream_url: `/v1/train/webgl2/stream/${encodeURIComponent(session.id)}`,
      });
      return;
    } catch (error) {
      const code = String(error.message || '').includes('required') ? 400 : 500;
      sendJson(res, code, { status: 'error', error: error.message });
      return;
    }
  }

  if (req.method === 'GET' && pathname.startsWith('/v1/train/webgl2/status/')) {
    const id = sessionIdFromPath('/v1/train/webgl2/status/', pathname);
    const session = sessions.get(id);
    if (!session) {
      sendJson(res, 404, { status: 'error', error: 'session_not_found' });
      return;
    }
    sendJson(res, 200, { status: 'ok', session: sessionSummary(session) });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/v1/train/webgl2/events/')) {
    const id = sessionIdFromPath('/v1/train/webgl2/events/', pathname);
    const session = sessions.get(id);
    if (!session) {
      sendJson(res, 404, { status: 'error', error: 'session_not_found' });
      return;
    }
    sendJson(res, 200, {
      status: 'ok',
      session: sessionSummary(session),
      events: session.events,
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/v1/train/webgl2/stream/')) {
    const id = sessionIdFromPath('/v1/train/webgl2/stream/', pathname);
    const session = sessions.get(id);
    if (!session) {
      sendJson(res, 404, { status: 'error', error: 'session_not_found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    for (const event of session.events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    session.subscribers.add(res);
    req.on('close', () => {
      session.subscribers.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/v1/train/webgl2/stop/')) {
    const id = sessionIdFromPath('/v1/train/webgl2/stop/', pathname);
    const session = sessions.get(id);
    if (!session) {
      sendJson(res, 404, { status: 'error', error: 'session_not_found' });
      return;
    }
    if (session.status !== 'running') {
      sendJson(res, 200, { status: 'ok', session: sessionSummary(session), message: 'session_not_running' });
      return;
    }
    session.status = 'stopping';
    try {
      session.child.kill();
      emitSessionEvent(session, 'session_stopping', {});
      sendJson(res, 200, { status: 'ok', session: sessionSummary(session) });
    } catch (error) {
      sendJson(res, 500, { status: 'error', error: error.message });
    }
    return;
  }

  sendJson(res, 404, { status: 'error', error: 'route_not_found' });
});

server.listen(PORT, '0.0.0.0', () => {
  writeTrace('server_started', { port: PORT, pid: process.pid });
  console.log(`KUHUL server listening on http://127.0.0.1:${PORT}`);
});

setInterval(() => {
  writeTrace('tick', {
    uptime: process.uptime(),
    sessions_running: Array.from(sessions.values()).filter((s) => s.status === 'running').length,
  });
}, 5000);

process.on('SIGINT', () => {
  writeTrace('shutdown', { reason: 'SIGINT' });
  for (const session of sessions.values()) {
    if (session.status === 'running') {
      try {
        session.child.kill();
      } catch {}
    }
  }
  server.close(() => process.exit(0));
});
