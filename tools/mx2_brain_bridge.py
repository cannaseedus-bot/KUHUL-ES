"""
mx2_brain_bridge.py — MX-2 Brain query tools.

Called by mcp_server.mjs or importable from kuhul_runtime_bridge.py.
Each verb returns JSON on stdout.
"""

from __future__ import annotations

import json
import pathlib
import sys

_HERE = pathlib.Path(__file__).parent
_BRAIN_DIR = _HERE / "MX-2" / "brains"

_BRAIN_FILES: dict[str, tuple[str, str]] = {
    "meta-intent-map": ("meta-intent-map.json", "intent routing map — query phrases → intent scores"),
    "micronaut-profiles": ("micronaut-profiles.json", "micronaut agent profiles with abilities, tools, ngram triggers"),
    "bigrams": ("bigrams.json", "bigram token pairs with frequency counts"),
    "trigrams": ("trigrams.json", "trigram token triples"),
    "ngrams_unigram": ("ngrams.unigram.tsv", "unigram token frequencies (TSV)"),
    "ngrams_bigram": ("ngrams.bigram.tsv", "bigram token frequencies (TSV)"),
    "mesh_brain": ("mesh.brain.json", "3D mesh skeleton bone data (47 bones)"),
    "tri_brain": ("tri_brain.scx.json", "triangle brain neural network manifest"),
    "tensors": ("tensors.tsv", "tensor weight data (TSV)"),
    "weights": ("weights.tsv", "ML weight data (TSV)"),
    "optimizer": ("optimizer.tsv", "optimizer state (TSV)"),
    "atomic_deep_scx": ("atomic_deep.scx.json", "deep brain SCX schema"),
    "atomic_fast_scx": ("atomic_fast.scx.json", "fast brain SCX schema"),
    "micronaut_demo": ("micronaut_demo.bson", "micronaut demo serialized data"),
}


def ok(data: dict) -> str:
    return json.dumps({"ok": True, **data}, default=str, indent=2)


def err(msg: str) -> str:
    return json.dumps({"ok": False, "error": msg})


def _load_json(path: pathlib.Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def cmd_brain_inspect() -> str:
    """List all MX-2 brain files with metadata."""
    results = []
    for key, (fname, desc) in _BRAIN_FILES.items():
        fp = _BRAIN_DIR / fname
        if fp.exists():
            stat = fp.stat()
            results.append({
                "id": key,
                "file": fname,
                "size_bytes": stat.st_size,
                "size_kb": round(stat.st_size / 1024, 1),
                "description": desc,
            })
    return ok({
        "verb": "brain_inspect",
        "brain_dir": str(_BRAIN_DIR),
        "brain_count": len(results),
        "brains": results,
    })


def cmd_brain_query_intent(query: str) -> str:
    """Search meta-intent-map for phrases matching the query."""
    fp = _BRAIN_DIR / "meta-intent-map.json"
    data = _load_json(fp)
    if data is None:
        return err(f"meta-intent-map.json not found or unreadable at {fp}")

    entries = data.get("data", {})
    query_lower = query.lower().strip()
    query_words = set(query_lower.split())

    scored = []
    for phrase, intents in entries.items():
        phrase_lower = phrase.lower()
        phrase_words = set(phrase_lower.split())
        if not query_words or not phrase_words:
            continue
        overlap = len(query_words & phrase_words)
        ratio = overlap / max(len(query_words), len(phrase_words))
        if ratio > 0 or phrase_lower.startswith(query_lower[:3]):
            scored.append((ratio, phrase, intents))

    scored.sort(key=lambda x: -x[0])
    top = scored[:10] if scored else []

    return ok({
        "verb": "brain_query_intent",
        "query": query,
        "match_count": len(top),
        "sealed": data.get("sealed", False),
        "version": data.get("version", ""),
        "matches": [
            {"phrase": phrase, "score": round(ratio, 3), "intents": intents}
            for ratio, phrase, intents in top
        ],
    })


def cmd_brain_query_profiles(query: str) -> str:
    """Search micronaut profiles by name, role, ability, or tool."""
    fp = _BRAIN_DIR / "micronaut-profiles.json"
    data = _load_json(fp)
    if data is None:
        return err(f"micronaut-profiles.json not found or unreadable at {fp}")

    profiles = data.get("profiles", {})
    query_lower = query.lower().strip()

    matches = []
    for pid, profile in profiles.items():
        name = profile.get("name", "")
        role = profile.get("role", "")
        abilities = profile.get("abilities", [])
        tools = profile.get("tools", [])

        fields_to_check = [name, role, pid] + abilities
        for t in tools:
            fields_to_check.append(t.get("name", ""))
            fields_to_check.append(t.get("description", ""))

        match_score = 0
        for field in fields_to_check:
            if query_lower in field.lower():
                match_score += 1

        if match_score > 0:
            matches.append({
                "id": pid,
                "name": name,
                "role": role,
                "abilities": abilities[:5],
                "tools": [t.get("name", "") for t in tools[:5]],
                "relevance": match_score,
            })

    matches.sort(key=lambda x: -x["relevance"])

    return ok({
        "verb": "brain_query_profiles",
        "query": query,
        "match_count": len(matches),
        "matches": matches[:15],
    })


def cmd_brain_query_ngrams(ngram_type: str, term: str) -> str:
    """Search bigram/trigram/unigram data for a term."""
    type_map = {
        "bigram": ("bigrams.json", "json_list"),
        "trigram": ("trigrams.json", "json_list"),
        "unigram": ("ngrams.unigram.tsv", "tsv"),
        "bigram_tsv": ("ngrams.bigram.tsv", "tsv"),
    }

    file_name, fmt = type_map.get(ngram_type, (None, None))
    if not file_name:
        return err(f"Unknown ngram type '{ngram_type}'. Valid: bigram, trigram, unigram, bigram_tsv")

    fp = _BRAIN_DIR / file_name
    if not fp.exists():
        return err(f"{file_name} not found")

    term_lower = term.lower().strip()
    results = []

    if fmt == "json_list":
        data = _load_json(fp)
        if data and "data" in data:
            for item in data["data"]:
                if isinstance(item, list) and len(item) >= 2:
                    phrase = str(item[0]).lower()
                    count = item[1]
                    if term_lower in phrase:
                        results.append({"phrase": item[0], "count": count})
    elif fmt == "tsv":
        text = fp.read_text(encoding="utf-8")
        for line in text.splitlines():
            parts = line.strip().split("\t")
            if len(parts) >= 2 and term_lower in parts[0].lower():
                results.append({"token": parts[0], "count": parts[1]})

    results.sort(key=lambda x: -int(x.get("count", 0)))
    return ok({
        "verb": "brain_query_ngrams",
        "ngram_type": ngram_type,
        "term": term,
        "match_count": len(results),
        "results": results[:20],
    })



def cmd_evolution_run() -> str:
    """Launch the ASX evolution engine (asx_evolution.exe) in background.
    Cleans up BMP snapshots from previous runs before starting.
    """
    import subprocess, os, glob
    exe = _HERE / "MX-2" / "evolution" / "build" / "Release" / "asx_evolution.exe"
    workdir = _HERE / "MX-2" / "evolution"
    if not exe.exists():
        return err(f"Evolution engine not found at {exe}")
    # Clean up old BMP snapshots from previous runs
    snap_dir = workdir / "evolution"
    removed = 0
    if snap_dir.exists():
        for bmp in snap_dir.glob("snap_agent_*.bmp"):
            try:
                bmp.unlink()
                removed += 1
            except Exception:
                pass
    try:
        proc = subprocess.Popen(
            [str(exe)],
            cwd=str(workdir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        return ok({
            "verb": "evolution_run",
            "pid": proc.pid,
            "exe": str(exe),
            "cleaned_bmps": removed,
            "note": f"Evolution started (PID {proc.pid}). Cleaned {removed} old BMPs.",
        })
    except Exception as e:
        return err(f"Failed to start evolution: {e}")



def cmd_node_resolve(node_id: str) -> str:
    '''Resolve a node through the XCFE engine (simulated). Returns node structure.'''
    import subprocess, json as _json
    reg = _json.loads((_HERE.parent / "kuhul" / "MX-2" / "micronaut.registry.json").read_text("utf-8"))
    nodes = reg.get("@nodes", {})
    if node_id not in nodes:
        return err(f"Node '{node_id}' not found. Valid: {', '.join(sorted(nodes.keys()))}")
    ndef = nodes[node_id]
    # Resolve fold
    fold_name = ndef.get("fold", "?")
    fold_key = None
    for fk in reg.get("@folds", {}):
        if fold_name.upper() in fk.upper():
            fold_key = fk
            break
    # Return XCFE-enriched node structure
    return ok({
        "verb": "node_resolve",
        "node_id": node_id,
        "xcfable": ndef.get("xcfable", False),
        "fold": fold_key or fold_name,
        "type": ndef.get("type", "unknown"),
        "micronauts": ndef.get("micronauts", []),
        "index": f"Fold resolves → Node locates → Micronaut acts: {fold_key or '?'} / {node_id}",
        "xcf_note": "XCFE phase transitions (Pop→Wo→Sek→Ch'en→Xul) operate on this node's state",
    })

def cmd_build_grams(dry_run: bool = False) -> str:
    """Run the auto gram builder."""
    import subprocess, sys as _sys
    DDS_BUILD = _HERE.parent / "DDS" / "build_grams.py"
    if not DDS_BUILD.exists():
        return err(f"build_grams.py not found at {DDS_BUILD}")
    cmd = [_sys.executable, str(DDS_BUILD)]
    if dry_run:
        cmd.append("--dry-run")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60, cwd=_HERE.parent)
        if result.returncode != 0:
            return err(f"build_grams failed: {result.stderr[:500]}")
        return ok({
            "verb": "build_grams",
            "dry_run": dry_run,
            "output": result.stdout,
        })
    except subprocess.TimeoutExpired:
        return err("build_grams timed out after 60s")
    except Exception as e:
        return err(f"build_grams error: {e}")


def cmd_brain_read(brain_id: str) -> str:
    """Read a specific brain file's content."""
    entry = _BRAIN_FILES.get(brain_id)
    if not entry:
        valid = sorted(_BRAIN_FILES.keys())
        return err(f"Unknown brain id '{brain_id}'. Valid: {', '.join(valid)}")

    fname, desc = entry
    fp = _BRAIN_DIR / fname
    if not fp.exists():
        return err(f"Brain file not found: {fname}")

    stat = fp.stat()
    truncated = False

    try:
        if fname.endswith(".json"):
            data = _load_json(fp)
            content = json.dumps(data, indent=2) if data else "(empty)"
        elif fname.endswith(".tsv"):
            content = fp.read_text(encoding="utf-8")
        elif fname.endswith(".bson"):
            content = f"(binary BSON, {stat.size} bytes)"
        else:
            content = f"(binary or unknown format, {stat.size} bytes)"
    except Exception as e:
        content = f"(error reading: {e})"

    if content and len(content) > 8000:
        content = content[:8000] + f"\n... (truncated, full size {stat.size} bytes)"
        truncated = True

    return ok({
        "verb": "brain_read",
        "brain_id": brain_id,
        "file": fname,
        "description": desc,
        "size_bytes": stat.st_size,
        "truncated": truncated,
        "content": content,
    })


# ═══════════════════════════════════════════════════════════════════════════
# CLI dispatcher
# ═══════════════════════════════════════════════════════════════════════════

def main():
    if len(sys.argv) < 2:
        print(err("Usage: python mx2_brain_bridge.py <verb> [args...]"))
        sys.exit(1)

    verb = sys.argv[1]
    args = sys.argv[2:]

    dispatch = {
        "brain_inspect": lambda: cmd_brain_inspect(),
        "brain_query_intent": lambda: cmd_brain_query_intent(args[0]) if args else err("brain_query_intent requires a query string"),
        "brain_query_profiles": lambda: cmd_brain_query_profiles(args[0]) if args else err("brain_query_profiles requires a query string"),
        "brain_query_ngrams": lambda: cmd_brain_query_ngrams(args[0], args[1]) if len(args) >= 2 else err("brain_query_ngrams requires ngram_type and term"),
        "brain_read": lambda: cmd_brain_read(args[0]) if args else err("brain_read requires a brain id"),
    "evolution_run": lambda: cmd_evolution_run(),
    "node_resolve": lambda: cmd_node_resolve(args[0]) if args else err("node_resolve requires a node id"),
    "build_grams": lambda: cmd_build_grams(dry_run="--dry-run" in sys.argv),
    }

    handler = dispatch.get(verb)
    if handler is None:
        print(err(f"Unknown verb '{verb}'. Valid: {', '.join(sorted(dispatch.keys()))}"))
        sys.exit(1)

    result = handler()
    print(result)


if __name__ == "__main__":
    main()
