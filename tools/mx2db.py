"""
mx2db.py — MX2DB: Unified database layer for the MX-2 Shard AI stack.

    MX2DB = IDB + JSON Object Server

Components:
  IDB (idb.instance.xml)
    • Persistent XML data bus  (namespace: x:scxq7:idb)
    • state/heap       — base64-encoded JSON key-value store (ASX-RAM)
    • causal           — inference provenance DAG (cause/effect/proof SHA-256)
    • schema-registry  — SCXQ2 / CM-1 / SCXQ7 / SMCA / SCX-BSON validators
    • causal-map       — schema dependency graph
    • federation-rules — multi-node determinism rules

  JSON Object Server (micronaut/server.js  @ :5775)
    • HTTP API for μ-ops: cm1_verify, kuhul_tsg, and file/environment operations
    • /object-op  → dispatches MuOps (bridge.js / Gemini LLM)
    • /files/*    → file system operations inside managed environments
    • /execute    → command execution (node, python, npm, pip)

  KUHUL DB Tables (backed by SQLite, with IDB fallback)
    • n_grams            — ngram frequency index
    • supagrams          — higher-order ngram patterns
    • rlhf_traces        — RLHF feedback signals
    • agent_state        — per-micronaut state snapshots
    • training_history   — fine-tune run records
    • tapes              — execution tape registry
    • gram_observations  — raw gram kernel observations
    • gram_patterns      — learned patterns
    • gram_macros        — synthesized macro expansions

Usage:
    from mx2db import MX2DB
    db = MX2DB()

    # ASX-RAM (KV via IDB heap)
    db.ram_set("supernaut.last_prompt", "hello")
    val = db.ram_get("supernaut.last_prompt")

    # KUHUL DB tables
    db.put("rlhf_traces", "trace-001", {"prompt": "...", "reward": 0.9})
    row = db.query("agent_state", "MM-1")

    # μ-ops via Object Server (or Python fallback)
    result = db.op("cm1_verify", input_text)

    # Causal trace
    db.log_causal(prompt_hash, reply_hash, backend_hash)

    db.flush()
"""

import base64
import hashlib
import json
import os
import re
import sqlite3
import urllib.request
import urllib.error
from pathlib import Path

_SHARDS     = Path(__file__).resolve().parent
_IDB_PATH   = _SHARDS / "idb.instance.xml"
_OBJECT_SRV = os.environ.get("OBJECT_SERVER_BASE", "http://127.0.0.1:5775")
_SQLITE_PATH = Path(os.environ.get("MX2DB_SQLITE_PATH", _SHARDS / "mx2db.sqlite"))

# Import IDB memory layer
try:
    import sys; sys.path.insert(0, str(_SHARDS))
    from idb_memory import IDBMemory, get_default as _idb_default
    _IDB_AVAILABLE = True
except ImportError:
    _IDB_AVAILABLE = False

# ── KUHUL DB table names ───────────────────────────────────────────────────────
_TABLES = [
    "n_grams", "supagrams", "rlhf_traces", "agent_state",
    "training_history", "tapes", "gram_observations",
    "gram_patterns", "gram_macros",
]

# ── ASX-RAM default key catalogue (from supernaut.khl manifest) ───────────────
_RAM_KEYS = {
    "os":      ["os.state", "os.boot.count", "os.active_tape"],
    "ui":      ["ui.active_surface", "ui.panels", "ui.theme"],
    "tapes":   ["tapes.active_id", "tapes.history", "tapes.registry"],
    "rlhf":    ["rlhf.forum.posts", "rlhf.forum.scores"],
    "trainer": ["trainer.jobs", "trainer.metrics"],
    "supernaut": [
        "supernaut.last_prompt", "supernaut.last_reply",
        "supernaut.last_backend", "supernaut.session_id", "supernaut.turn_count",
    ],
    "mx2":     ["mx2.active_model", "mx2.lm_studio_enabled"],
    "validator": ["validator.last_score", "validator.last_feedback"],
    "builder": [
        "builder.last_query", "builder.last_stack",
        "builder.mesh_base", "builder.agent_state",
    ],
}


def _sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _table_key(table: str, key: str) -> str:
    """IDB heap key for a DB table row."""
    return f"mx2db.{table}.{key}"


# ── JSON Object Server μ-ops client ───────────────────────────────────────────

def _call_object_server(op_name: str, op_input: str, timeout: int = 15) -> dict | None:
    """
    Call a μ-op on the JSON Object Server at :5775.
    Returns result dict or None if server unavailable.
    """
    # Quick health check
    try:
        urllib.request.urlopen(f"{_OBJECT_SRV}/health", timeout=2)
    except Exception:
        return None

    payload = json.dumps({"name": op_name, "input": op_input}).encode()
    try:
        req = urllib.request.Request(
            f"{_OBJECT_SRV}/object-op",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
        if data.get("success"):
            return data.get("result")
    except Exception:
        pass
    return None


# ── Python-native μ-op fallbacks ──────────────────────────────────────────────

def _fallback_cm1_verify(input_text: str) -> dict:
    """
    Python-native CM-1 verification fallback (no LLM required).
    Checks structural rules: has required fields, starts/ends with markers.
    """
    text = input_text.strip()
    errors = []
    has_markers = "--- MESSAGE ---" in text and "--- END ---" in text
    has_id      = bool(re.search(r'\bid\s*[=:]\s*\S', text, re.IGNORECASE))
    has_intent  = bool(re.search(r'\bintent\s*[=:]\s*(chat|generate|classify|complete)', text, re.IGNORECASE))
    has_role    = bool(re.search(r'\brole\s*[=:]\s*(user|system|micronaut)', text, re.IGNORECASE))

    if not has_markers:
        errors.append("Missing --- MESSAGE --- / --- END --- markers")
    if not has_id:
        errors.append("Missing 'id' field")
    if not has_intent:
        errors.append("Missing/invalid 'intent' (must be chat|generate|classify|complete)")
    if not has_role:
        errors.append("Missing/invalid 'role' (must be user|system|micronaut)")

    is_valid = len(errors) == 0
    return {"isValid": is_valid, "reason": "; ".join(errors) if errors else "OK", "backend": "python-fallback"}


def _fallback_kuhul_tsg(input_text: str) -> dict:
    """
    Python-native KUHUL-TSG (token-signal generator) fallback.
    Extracts intent, role, and entities from the message text.
    """
    text = input_text.lower()

    # Intent detection
    if any(k in text for k in ("generate", "create", "write", "build")):
        intent = "generate"
    elif any(k in text for k in ("classify", "categorize", "label", "identify")):
        intent = "classify"
    elif any(k in text for k in ("complete", "finish", "continue", "fill")):
        intent = "complete"
    else:
        intent = "chat"

    # Role detection
    if any(k in text for k in ("system:", "[system]", "micronaut:")):
        role = "system"
    elif any(k in text for k in ("micronaut", "bot:", "[bot]")):
        role = "micronaut"
    else:
        role = "user"

    # Simple entity extraction (capitalized words / quoted strings)
    entities = re.findall(r'"([^"]+)"|\'([^\']+)\'|([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)', input_text)
    entities_flat = [e[0] or e[1] or e[2] for e in entities if any(e)][:10]

    return {
        "intent": intent,
        "role": role,
        "entities": entities_flat,
        "timestamp": 0,
        "backend": "python-fallback",
    }


# ── MX2DB class ───────────────────────────────────────────────────────────────

class MX2DB:
    """
    MX2DB: Combined IDB + JSON Object Server database layer.

    • IDB operations (heap KV, causal trace) via idb_memory.IDBMemory
    • Object Server μ-ops via HTTP :5775 (with Python fallbacks)
    • KUHUL DB table operations (put/query/scan) backed by SQLite, with IDB fallback
    • ASX-RAM operations (ram_get/ram_set) mapped to IDB heap
    """

    def __init__(self):
        self._idb: "IDBMemory | None" = _idb_default() if _IDB_AVAILABLE else None
        self._sqlite = sqlite3.connect(_SQLITE_PATH)
        self._sqlite.row_factory = sqlite3.Row
        self._init_sqlite()

    def _init_sqlite(self) -> None:
        self._sqlite.execute(
            """
            CREATE TABLE IF NOT EXISTS mx2db_kv (
                table_name TEXT NOT NULL,
                row_key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (table_name, row_key)
            )
            """
        )
        self._sqlite.commit()

    def _sqlite_put(self, table: str, key: str, value) -> None:
        value_json = json.dumps(value, ensure_ascii=False)
        self._sqlite.execute(
            """
            INSERT INTO mx2db_kv (table_name, row_key, value_json, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(table_name, row_key)
            DO UPDATE SET value_json=excluded.value_json, updated_at=datetime('now')
            """,
            (table, key, value_json),
        )
        self._sqlite.commit()

    def _sqlite_get(self, table: str, key: str, default=None):
        cur = self._sqlite.execute(
            "SELECT value_json FROM mx2db_kv WHERE table_name = ? AND row_key = ?",
            (table, key),
        )
        row = cur.fetchone()
        if row is None:
            return default
        try:
            return json.loads(row["value_json"])
        except Exception:
            return row["value_json"]

    def _sqlite_scan(self, table: str) -> dict:
        cur = self._sqlite.execute(
            "SELECT row_key, value_json FROM mx2db_kv WHERE table_name = ?",
            (table,),
        )
        rows = {}
        for row in cur.fetchall():
            try:
                rows[row["row_key"]] = json.loads(row["value_json"])
            except Exception:
                rows[row["row_key"]] = row["value_json"]
        return rows

    # ── IDB / ASX-RAM (key-value) ─────────────────────────────────────────────

    def ram_get(self, key: str, default=None):
        """Get a value from ASX-RAM (IDB heap)."""
        if self._idb is None:
            return default
        return self._idb.get(key, default)

    def ram_set(self, key: str, value) -> None:
        """Set a value in ASX-RAM (IDB heap). Call flush() to persist."""
        if self._idb:
            self._idb.set(key, value)

    def ram_delete(self, key: str) -> bool:
        if self._idb:
            return self._idb.delete(key)
        return False

    def ram_list(self, prefix: str = "") -> list[str]:
        """List ASX-RAM keys, optionally filtered by prefix."""
        if self._idb is None:
            return []
        return self._idb.list_keys(prefix)

    def ram_all(self, prefix: str = "") -> dict:
        """Return all ASX-RAM key/value pairs (optionally prefix-filtered)."""
        if self._idb is None:
            return {}
        return self._idb.get_all(prefix)

    # ── KUHUL DB tables ───────────────────────────────────────────────────────

    def put(self, table: str, key: str, value: dict | str | int | float) -> None:
        """Insert or overwrite a row in a KUHUL DB table."""
        self._sqlite_put(table, key, value)
        self.ram_set(_table_key(table, key), value)

    def query(self, table: str, key: str, default=None):
        """Look up a single row from a KUHUL DB table."""
        value = self._sqlite_get(table, key, None)
        if value is not None:
            return value
        return self.ram_get(_table_key(table, key), default)

    def scan(self, table: str) -> dict:
        """Return all rows in a KUHUL DB table as {key: value}."""
        rows = self._sqlite_scan(table)
        if rows:
            return rows
        prefix = f"mx2db.{table}."
        raw = self.ram_all(prefix)
        strip = len(prefix)
        return {k[strip:]: v for k, v in raw.items()}

    def delete_row(self, table: str, key: str) -> bool:
        self._sqlite.execute(
            "DELETE FROM mx2db_kv WHERE table_name = ? AND row_key = ?",
            (table, key),
        )
        self._sqlite.commit()
        return self.ram_delete(_table_key(table, key))

    # ── Ngram helpers ─────────────────────────────────────────────────────────

    def ngram_record(self, ngram: str, count: int = 1) -> None:
        """Increment an ngram frequency counter in the n_grams table."""
        existing = self.query("n_grams", ngram, 0)
        self.put("n_grams", ngram, (existing or 0) + count)

    def ngram_top(self, n: int = 20) -> list[tuple[str, int]]:
        """Return top-N ngrams by frequency."""
        rows = self.scan("n_grams")
        return sorted(rows.items(), key=lambda x: x[1], reverse=True)[:n]

    # ── RLHF trace helpers ────────────────────────────────────────────────────

    def rlhf_record(self, trace_id: str, micronaut_id: str,
                    prompt: str, reply: str, reward: float,
                    feedback: str = "") -> None:
        """Record an RLHF signal for a micronaut response."""
        self.put("rlhf_traces", trace_id, {
            "micronaut": micronaut_id,
            "prompt": prompt[:500],
            "reply": reply[:500],
            "reward": reward,
            "feedback": feedback[:300],
        })

    # ── Agent state helpers ───────────────────────────────────────────────────

    def agent_state_set(self, micronaut_id: str, state: dict) -> None:
        """Persist agent state for a micronaut."""
        self.put("agent_state", micronaut_id, state)

    def agent_state_get(self, micronaut_id: str) -> dict:
        return self.query("agent_state", micronaut_id, {})

    # ── Causal trace (IDB DAG) ────────────────────────────────────────────────

    def log_causal(self, cause: str, effect: str, proof: str,
                   step_id: str | None = None) -> str | None:
        """Append a causal inference step to the IDB DAG."""
        if self._idb is None:
            return None
        return self._idb.log_causal(cause, effect, proof, step_id)

    def get_causal_steps(self, last_n: int = 10) -> list[dict]:
        if self._idb is None:
            return []
        return self._idb.get_causal_steps(last_n)

    # ── μ-op dispatch (Object Server → Python fallback) ──────────────────────

    def op(self, op_name: str, input_text: str) -> dict:
        """
        Dispatch a μ-op.

        Tries the JSON Object Server at :5775 first.
        Falls back to Python-native implementations.

        Supported ops:
          cm1_verify   — structural CM-1 gate verification
          kuhul_tsg    — token-signal generation / intent extraction
        """
        # Try live Object Server
        result = _call_object_server(op_name, input_text)
        if result is not None:
            if isinstance(result, dict):
                result["backend"] = "object-server:5775"
            return result if isinstance(result, dict) else {"result": result, "backend": "object-server:5775"}

        # Python fallbacks
        if op_name == "cm1_verify":
            return _fallback_cm1_verify(input_text)
        if op_name == "kuhul_tsg":
            return _fallback_kuhul_tsg(input_text)

        return {"error": f"μ-op '{op_name}' unknown and Object Server unavailable", "backend": "none"}

    def cm1_verify(self, text: str) -> dict:
        """Shorthand: dispatch cm1_verify μ-op."""
        return self.op("cm1_verify", text)

    def kuhul_tsg(self, text: str) -> dict:
        """Shorthand: dispatch kuhul_tsg μ-op."""
        return self.op("kuhul_tsg", text)

    # ── Flush / persist ───────────────────────────────────────────────────────

    def flush(self) -> bool:
        """Flush dirty IDB heap to idb.instance.xml. Returns True if written."""
        if self._sqlite:
            self._sqlite.commit()
        if self._idb:
            return self._idb.flush()
        return False

    # ── Schema registry ───────────────────────────────────────────────────────

    def schemas(self) -> list[dict]:
        """Return the IDB schema registry entries."""
        if self._idb is None:
            return []
        return self._idb.get_schema_registry()

    # ── Status ────────────────────────────────────────────────────────────────

    def status(self) -> dict:
        """Return live status of all MX2DB components."""
        # IDB status
        idb_status = self._idb.status() if self._idb else {"available": False}

        # Object Server status
        obj_srv_live = False
        try:
            urllib.request.urlopen(f"{_OBJECT_SRV}/health", timeout=2)
            obj_srv_live = True
        except Exception:
            pass

        # Table row counts
        table_counts = {t: len(self.scan(t)) for t in _TABLES}

        return {
            "idb": idb_status,
            "sqlite": {
                "path": str(_SQLITE_PATH),
                "available": True,
            },
            "object_server": {
                "url": _OBJECT_SRV,
                "live": obj_srv_live,
                "mu_ops": ["cm1_verify", "kuhul_tsg"],
                "fallback": "python-native",
            },
            "tables": table_counts,
            "asx_ram_key_count": len(self.ram_list()),
        }


# ── Module-level singleton ─────────────────────────────────────────────────────

_default_db: MX2DB | None = None


def get_default() -> MX2DB:
    """Return (or create) the shared MX2DB instance."""
    global _default_db
    if _default_db is None:
        _default_db = MX2DB()
    return _default_db


if __name__ == "__main__":
    import sys as _sys
    db = get_default()
    args = _sys.argv[1:]

    if not args or args[0] == "--status":
        print(json.dumps(db.status(), indent=2))

    elif args[0] == "--op" and len(args) >= 3:
        result = db.op(args[1], " ".join(args[2:]))
        print(json.dumps(result, indent=2))

    elif args[0] == "--ram-get" and len(args) > 1:
        print(db.ram_get(args[1], "(not set)"))

    elif args[0] == "--ram-set" and len(args) > 2:
        db.ram_set(args[1], args[2])
        db.flush()
        print(f"Set {args[1]} = {args[2]}")

    elif args[0] == "--ram-list":
        prefix = args[1] if len(args) > 1 else ""
        for k, v in db.ram_all(prefix).items():
            print(f"{k} = {v}")

    elif args[0] == "--table" and len(args) > 1:
        rows = db.scan(args[1])
        print(json.dumps(rows, indent=2))

    elif args[0] == "--causal":
        print(json.dumps(db.get_causal_steps(20), indent=2))

    elif args[0] == "--schemas":
        print(json.dumps(db.schemas(), indent=2))

    else:
        print("Usage: mx2db.py [--status | --op <name> <input> | --ram-get <key> |")
        print("                 --ram-set <key> <value> | --ram-list [prefix] |")
        print("                 --table <name> | --causal | --schemas]")
