"""
idb_memory.py — Integrated Data Bus (IDB) memory layer for the MX-2 Shard AI stack.

The IDB is defined by idb.schema.xsd (namespace: x:scxq7:idb).
This module wraps idb.instance.xml as a persistent cognitive memory store.

Structure used:
  <idb>
    <state hash="sha256:...">
      <heap encoding="base64">           ← JSON dict (key → value store)
    </state>
    <causal>
      <step id="..." time="...">         ← causal inference trace
        <cause hash="sha256:..."/>
        <effect hash="sha256:..."/>
        <proof hash="sha256:..."/>
      </step>
    </causal>
    <schema-registry>                    ← schema validation rules (read-only)
    <causal-map>                         ← schema dependency graph (read-only)
    <federation-rules>                   ← validation federation rules (read-only)
  </idb>

The IDB heap (state.heap base64 → JSON) is used as the KV memory store.
Causal steps record the inference provenance (cause/effect/proof SHA-256 hashes).

Usage:
    from idb_memory import IDBMemory
    mem = IDBMemory()
    mem.set("supernaut.last_prompt", "hello world")
    val = mem.get("supernaut.last_prompt")
    mem.log_causal(prompt_hash, reply_hash, backend_hash)
    mem.flush()
"""

import base64
import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

_SHARDS   = Path(__file__).resolve().parent
_IDB_PATH = _SHARDS / "idb.instance.xml"
_NS       = "x:scxq7:idb"

# ET namespace registration (suppress ns0: prefix on write)
ET.register_namespace("", _NS)

_MAX_CAUSAL_STEPS = 1000  # rolling window; prune oldest when exceeded
_lock = threading.Lock()


def _sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _tag(local: str) -> str:
    return f"{{{_NS}}}{local}"


class IDBMemory:
    """
    Persistent cognitive memory backed by idb.instance.xml (IDB format).

    Thread-safe: all reads/writes use a module-level lock + in-process cache.
    The heap is a JSON dict stored base64-encoded in <state><heap>.
    Causal steps are appended to <causal> as provenance for each inference.
    """

    def __init__(self, path: Path | str = _IDB_PATH):
        self._path = Path(path)
        self._heap: dict = {}
        self._tree: ET.ElementTree | None = None
        self._loaded = False
        self._dirty = False

    # ── Internal XML helpers ──────────────────────────────────────────────────

    def _load(self):
        if self._loaded:
            return
        if not self._path.exists():
            self._heap = {}
            self._tree = None
            self._loaded = True
            return
        try:
            self._tree = ET.parse(str(self._path))
            root = self._tree.getroot()
            state = root.find(_tag("state"))
            if state is not None:
                heap_el = state.find(_tag("heap"))
                if heap_el is not None and heap_el.text:
                    raw = base64.b64decode(heap_el.text.strip()).decode("utf-8")
                    self._heap = json.loads(raw)
        except Exception:
            self._heap = {}
        self._loaded = True

    def _ensure_tree(self):
        """Build a minimal IDB tree if one doesn't exist."""
        if self._tree is not None:
            return
        root = ET.Element(_tag("idb"), {"version": "1.0"})
        ET.SubElement(root, _tag("schema-registry"), {"version": "1.0"})
        ET.SubElement(root, _tag("causal-map"))
        state_el = ET.SubElement(root, _tag("state"), {"hash": _sha256("{}")})
        heap_el = ET.SubElement(state_el, _tag("heap"), {"encoding": "base64"})
        heap_el.text = base64.b64encode(b"{}").decode("ascii")
        ET.SubElement(root, _tag("causal"))
        ET.SubElement(root, _tag("constraints"), {"id": "validator-invariants"})
        self._tree = ET.ElementTree(root)

    def _write(self):
        """Serialize heap back to XML and write to disk."""
        self._ensure_tree()
        root = self._tree.getroot()
        state_el = root.find(_tag("state"))
        if state_el is None:
            state_el = ET.SubElement(root, _tag("state"), {"hash": ""})
        heap_el = state_el.find(_tag("heap"))
        if heap_el is None:
            heap_el = ET.SubElement(state_el, _tag("heap"), {"encoding": "base64"})
        heap_json = json.dumps(self._heap, ensure_ascii=False, separators=(",", ":"))
        heap_bytes = heap_json.encode("utf-8")
        heap_el.text = base64.b64encode(heap_bytes).decode("ascii")
        heap_el.set("encoding", "base64")
        state_el.set("hash", _sha256(heap_json))

        # Write with pretty-ish indentation
        ET.indent(root, space="  ")
        tree = ET.ElementTree(root)
        tree.write(str(self._path), encoding="UTF-8", xml_declaration=True)
        self._dirty = False

    # ── Public KV API ─────────────────────────────────────────────────────────

    def get(self, key: str, default=None):
        """Get a value from IDB heap by key."""
        with _lock:
            self._load()
            return self._heap.get(key, default)

    def set(self, key: str, value) -> None:
        """Set a key in IDB heap. Does not flush to disk until flush() is called."""
        with _lock:
            self._load()
            self._heap[key] = value
            self._dirty = True

    def delete(self, key: str) -> bool:
        """Delete a key from IDB heap. Returns True if it existed."""
        with _lock:
            self._load()
            if key in self._heap:
                del self._heap[key]
                self._dirty = True
                return True
            return False

    def list_keys(self, prefix: str = "") -> list[str]:
        """List all keys, optionally filtered by prefix."""
        with _lock:
            self._load()
            if prefix:
                return [k for k in self._heap if k.startswith(prefix)]
            return list(self._heap.keys())

    def get_all(self, prefix: str = "") -> dict:
        """Return a copy of all KV pairs, optionally filtered by prefix."""
        with _lock:
            self._load()
            if prefix:
                return {k: v for k, v in self._heap.items() if k.startswith(prefix)}
            return dict(self._heap)

    def flush(self) -> bool:
        """Write dirty heap to disk. Returns True if a write occurred."""
        with _lock:
            self._load()
            if not self._dirty:
                return False
            try:
                self._write()
                return True
            except Exception:
                return False

    # ── MX-2 W-update reader ──────────────────────────────────────────────────

    def apply_w_updates(self, jsonl_path: "Path | str", alpha: float = 0.05) -> int:
        """
        Read new records from mx2_W_updates.jsonl and apply EMA to stored W per node.

        W is slow-moving competence — evolved across folds via EMA with small alpha.
        C is updated within each fold by ChenStage. W is deferred to here.

        EMA:        W_new = (1 - alpha) * W_stored + alpha * W_observed
        Cold start: W_new = W_observed  (first record for this node)

        Records where W < 0 (factory path with no µ-field entry) are skipped.

        A byte-offset cursor stored in the IDB under 'mx2.cursor.<stem>' ensures
        previously processed records are never reapplied across runs.

        Returns the count of new records applied.
        """
        jsonl_path = Path(jsonl_path)
        if not jsonl_path.exists():
            return 0

        cursor_key = f"mx2.cursor.{jsonl_path.stem}"
        with _lock:
            self._load()
            cursor = int(self._heap.get(cursor_key, 0))

            applied = 0
            with jsonl_path.open("rb") as f:
                f.seek(cursor)
                for raw in f:
                    line = raw.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    node    = rec.get("node", "")
                    W_obs   = rec.get("W")
                    outcome = rec.get("outcome", "")
                    reward  = rec.get("reward", 0.0)
                    ts      = rec.get("ts", 0)

                    # Skip records with no valid W (evolution/factory path)
                    if not node or W_obs is None or float(W_obs) < 0:
                        continue

                    w_key  = f"mu.W.{node}"
                    W_prev = self._heap.get(w_key)
                    if W_prev is None:
                        W_new = float(W_obs)
                    else:
                        W_new = (1.0 - alpha) * float(W_prev) + alpha * float(W_obs)

                    self._heap[w_key]                   = round(W_new, 6)
                    self._heap[f"mu.last_reward.{node}"]    = reward
                    self._heap[f"mu.last_outcome.{node}"]   = outcome
                    self._heap[f"mu.last_fold_ts.{node}"]   = ts
                    self._heap[f"mu.W_count.{node}"]        = int(self._heap.get(f"mu.W_count.{node}", 0)) + 1
                    applied += 1

                self._heap[cursor_key] = f.tell()

            if applied > 0:
                self._dirty = True

            return applied

    def write_seed(self, seed_path: "Path | str") -> int:
        """
        Write a lightweight {node: W} JSON file for non-Python runtimes
        (e.g. C# FoldOrchestrator). Returns count of nodes written.
        """
        table = self.get_w_table()
        seed = {node: info["W"] for node, info in table.items()}
        Path(seed_path).write_text(
            json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return len(seed)

    def get_w_table(self) -> dict:
        """
        Return {node: {W, count, last_reward, last_outcome, last_fold_ts}}
        for all micronauts with stored W in the IDB.
        """
        with _lock:
            self._load()
            table = {}
            for key, val in self._heap.items():
                if not key.startswith("mu.W.") or key.startswith("mu.W_count."):
                    continue
                node = key[len("mu.W."):]
                table[node] = {
                    "W":             val,
                    "count":         self._heap.get(f"mu.W_count.{node}", 0),
                    "last_reward":   self._heap.get(f"mu.last_reward.{node}"),
                    "last_outcome":  self._heap.get(f"mu.last_outcome.{node}"),
                    "last_fold_ts":  self._heap.get(f"mu.last_fold_ts.{node}"),
                }
            return table

    # ── Causal trace API ──────────────────────────────────────────────────────

    def log_causal(self, cause: str, effect: str, proof: str,
                   step_id: str | None = None) -> str:
        """
        Append a causal step to the IDB causal trace.

        Args:
            cause:  SHA-256 hash of the input (prompt)
            effect: SHA-256 hash of the output (reply)
            proof:  SHA-256 hash of the backend/model that produced the reply
            step_id: optional explicit ID; auto-generated if not provided

        Returns:
            The step_id used.
        """
        with _lock:
            self._load()
            self._ensure_tree()
            root = self._tree.getroot()
            causal_el = root.find(_tag("causal"))
            if causal_el is None:
                causal_el = ET.SubElement(root, _tag("causal"))

            # Prune old steps if over limit
            steps = causal_el.findall(_tag("step"))
            while len(steps) >= _MAX_CAUSAL_STEPS:
                causal_el.remove(steps.pop(0))

            # Generate step id
            if not step_id:
                step_id = f"step-{len(steps)+1}"

            step_el = ET.SubElement(causal_el, _tag("step"),
                                    {"id": step_id, "time": _now_iso()})
            ET.SubElement(step_el, _tag("cause"), {"hash": cause if cause.startswith("sha256:") else _sha256(cause)})
            ET.SubElement(step_el, _tag("effect"), {"hash": effect if effect.startswith("sha256:") else _sha256(effect)})
            ET.SubElement(step_el, _tag("proof"), {"hash": proof if proof.startswith("sha256:") else _sha256(proof)})

            self._dirty = True
            return step_id

    def get_causal_steps(self, last_n: int = 10) -> list[dict]:
        """Return the last N causal steps as a list of dicts."""
        with _lock:
            self._load()
            if not self._tree:
                return []
            root = self._tree.getroot()
            causal_el = root.find(_tag("causal"))
            if causal_el is None:
                return []
            steps = causal_el.findall(_tag("step"))[-last_n:]
            result = []
            for s in steps:
                cause = s.find(_tag("cause"))
                effect = s.find(_tag("effect"))
                proof = s.find(_tag("proof"))
                result.append({
                    "id": s.get("id", ""),
                    "time": s.get("time", ""),
                    "cause": cause.get("hash", "") if cause is not None else "",
                    "effect": effect.get("hash", "") if effect is not None else "",
                    "proof": proof.get("hash", "") if proof is not None else "",
                })
            return result

    # ── Schema registry reader (read-only) ───────────────────────────────────

    def get_schema_registry(self) -> list[dict]:
        """Return the schema registry entries from the IDB."""
        with _lock:
            self._load()
            if not self._tree:
                return []
            root = self._tree.getroot()
            reg = root.find(_tag("schema-registry"))
            if reg is None:
                return []
            result = []
            for schema in reg.findall(_tag("schema")):
                entry = {
                    "id": schema.get("id", ""),
                    "version": schema.get("version", ""),
                    "authority": schema.get("authority", ""),
                }
                src = schema.find(_tag("source"))
                val = schema.find(_tag("validator"))
                det = schema.find(_tag("deterministic"))
                if src is not None:
                    entry["source"] = src.text or ""
                if val is not None:
                    entry["validator"] = val.text or ""
                if det is not None:
                    entry["deterministic"] = (det.text or "").strip().lower() == "true"
                result.append(entry)
            return result

    # ── Convenience helpers ───────────────────────────────────────────────────

    @staticmethod
    def hash_text(text: str) -> str:
        """Return sha256:hex of a string (for causal step hashes)."""
        return _sha256(text)

    def status(self) -> dict:
        """Return status of the IDB memory layer."""
        with _lock:
            self._load()
        return {
            "path": str(self._path),
            "exists": self._path.exists(),
            "heap_keys": len(self._heap),
            "dirty": self._dirty,
            "schemas": len(self.get_schema_registry()),
            "causal_steps": len(self.get_causal_steps(1000)),
        }


# ── Module-level singleton ─────────────────────────────────────────────────────

_default_mem: IDBMemory | None = None


def get_default() -> IDBMemory:
    """Return (or create) the default IDB memory instance backed by idb.instance.xml."""
    global _default_mem
    if _default_mem is None:
        _default_mem = IDBMemory(_IDB_PATH)
    return _default_mem


if __name__ == "__main__":
    import sys
    mem = get_default()
    args = sys.argv[1:]
    if not args or args[0] == "--status":
        import json as _json
        print(_json.dumps(mem.status(), indent=2))
    elif args[0] == "--get" and len(args) > 1:
        print(mem.get(args[1], "(not set)"))
    elif args[0] == "--set" and len(args) > 2:
        mem.set(args[1], args[2])
        mem.flush()
        print(f"Set {args[1]} = {args[2]}")
    elif args[0] == "--list":
        prefix = args[1] if len(args) > 1 else ""
        keys = mem.list_keys(prefix)
        for k in keys:
            print(f"{k} = {mem.get(k)}")
    elif args[0] == "--causal":
        steps = mem.get_causal_steps(20)
        import json as _json
        print(_json.dumps(steps, indent=2))
    elif args[0] == "--schemas":
        import json as _json
        print(_json.dumps(mem.get_schema_registry(), indent=2))
    elif args[0] == "--apply-w-updates" and len(args) > 1:
        jsonl = args[1]
        alpha = float(args[2]) if len(args) > 2 else 0.05
        count = mem.apply_w_updates(jsonl, alpha=alpha)
        mem.flush()
        print(f"Applied {count} W-update record(s) from {jsonl}  (alpha={alpha})")
        # auto-write seed alongside the JSONL for C# orchestrator pickup
        seed_path = Path(jsonl).parent / "mu_w_seed.json"
        n_seed = mem.write_seed(seed_path)
        print(f"Wrote seed ({n_seed} node(s)) -> {seed_path}")
        table = mem.get_w_table()
        if table:
            print()
            for node, info in sorted(table.items()):
                outcome = info.get("last_outcome") or "-"
                reward  = info.get("last_reward")
                reward_s = f"{reward:.4f}" if reward is not None else "-"
                print(f"  {node:20s}  W={info['W']:.6f}  n={info['count']:3d}  "
                      f"outcome={outcome:8s}  reward={reward_s}")
    elif args[0] == "--show-w":
        import json as _json
        table = mem.get_w_table()
        if table:
            print(_json.dumps(table, indent=2))
        else:
            print("(no W records in IDB)")
    else:
        print("Usage: idb_memory.py [--status|--get <key>|--set <key> <val>|"
              "--list [prefix]|--causal|--schemas|"
              "--apply-w-updates <jsonl> [alpha]|--show-w]")
