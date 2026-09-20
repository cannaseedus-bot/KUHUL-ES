"""
kuhul_runtime_bridge.py — K'UHUL Runtime MCP Bridge

Called by mcp_server.mjs via `python kuhul_runtime_bridge.py <verb> [args...]`.
Returns JSON on stdout. Errors are JSON with {"ok": false, "error": "..."}.

Verbs:
    phase_status              → {phase, trace, stats, available_glyphs, ...}
    phase_transition <phase>  → transitions phase engine, returns new state
    phase_dispatch <glyph>    → dispatch a glyph op through phase engine
    xcfe_validate <sequence>  → validate phase sequence against XCFE algebra
    xcfe_iterate [cycles]     → simulate training iterations
    runtime_spec [section]    → read spec.toml (optional section filter)
    runtime_services          → list all services with ports from spec.toml
    runtime_endpoints         → list transport endpoints
    gpu_status                → probe iGPU via wgpu-py
    dispatch_priority         → show dispatch priority order
    object_server_health      → check object server /health on :8084
    runtime_status            → aggregated runtime status with links
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

_HERE = pathlib.Path(__file__).parent
_ROOT = _HERE.parent
_SPEC_PATH = _ROOT / "kuhul" / "spec.toml"

if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def ok(data: dict) -> str:
    return json.dumps({"ok": True, **data}, default=str, indent=2)


def err(msg: str) -> str:
    return json.dumps({"ok": False, "error": msg})


def read_spec() -> dict | None:
    """Parse spec.toml — simple section parser (no external dep)."""
    if not _SPEC_PATH.exists():
        return None
    text = _SPEC_PATH.read_text(encoding="utf-8")
    sections: dict[str, dict] = {}
    current_section: str | None = None
    current: dict = {}
    # Collect raw lines per section first (handles multi-line arrays)
    section_lines: dict[str, list[str]] = {}
    # Collect ALL raw lines per section (including multi-line array continuations)
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("---"):
            continue
        if stripped.startswith("[") and stripped.endswith("]"):
            current_section = stripped[1:-1]
            if current_section not in section_lines:
                section_lines[current_section] = []
        elif current_section:
            section_lines[current_section].append(line)
    # Parse each section
    import re
    for sec, lines in section_lines.items():
        current = {}
        # Join continuation lines for multi-line arrays
        joined = "\n".join(lines)
        # Find key = [ ... ] patterns that can span multiple lines
        array_pattern = re.compile(r'(\w+)\s*=\s*\[(.*?)\]', re.DOTALL)
        scalar_pattern = re.compile(r'(\w+)\s*=\s*"([^"]*)"')
        plain_pattern = re.compile(r'(\w+)\s*=\s*(\S+)')
        # Process multi-line arrays first
        remaining = joined
        for m in array_pattern.finditer(joined):
            key = m.group(1)
            raw = m.group(2).strip()
            items = [x.strip().strip('"').strip("'") for x in raw.split(",") if x.strip()]
            current[key] = items
            remaining = remaining.replace(m.group(0), "")
        # Process quoted values (including dotted and wildcard keys)
        for m in re.finditer(r'(\S+?)\s*=\s*"([^"]*)"', remaining):
            key = m.group(1).strip('"').strip("'")
            if key and key not in current:
                current[key] = m.group(2)
        # Process plain values
        for m in plain_pattern.finditer(remaining):
            if m.group(1) not in current:
                val = m.group(2)
                if val.lower() == "true":
                    val = True
                elif val.lower() == "false":
                    val = False
                current[m.group(1)] = val
        sections[sec] = current
    return sections


# ═══════════════════════════════════════════════════════════════════════════
# Phase Engine verbs
# ═══════════════════════════════════════════════════════════════════════════

def cmd_phase_status() -> str:
    """Instantiate PhaseEngine and return current state."""
    try:
        from phase_engine import PhaseEngine, Phase
    except ImportError as e:
        return err(f"phase_engine import failed: {e}")

    pe = PhaseEngine(strict=False, log=False)
    return ok({
        "verb": "phase_status",
        "current_phase": pe.current_phase.name if hasattr(pe.current_phase, 'name') else str(pe.current_phase),
        "trace_count": len(pe.trace),
        "stats": pe.stats() if hasattr(pe, 'stats') and callable(pe.stats) else {},
        "available_glyphs": sorted(pe.glyphs()) if hasattr(pe, 'glyphs') and callable(pe.glyphs) else [],
        "note": "PhaseEngine created fresh (non-persistent across calls). Run phase_transition to advance phases."
    })


def cmd_phase_transition(target: str) -> str:
    """Advance to a named phase."""
    try:
        from phase_engine import PhaseEngine, Phase
        from xcfe import PHASE_NAMES, XCFEViolation
    except ImportError as e:
        return err(f"import failed: {e}")

    phase_map = {
        "pop": Phase.POP, "wo": Phase.WO, "yax": Phase.YAX,
        "sek": Phase.SEK, "chen": Phase.CHEN, "ch'en": Phase.CHEN, "xul": Phase.XUL
    }
    target_phase = phase_map.get(target.lower().strip())
    if target_phase is None:
        return err(f"Unknown phase '{target}'. Valid: pop, wo, yax, sek, chen, xul")

    pe = PhaseEngine(strict=False, log=False)
    try:
        # Use the PhaseEngine's internal _set_phase via ch'en→wo for training loops
        # or advance normally through xcfe_plane
        if hasattr(pe, '_xcfe') and pe._xcfe is not None:
            pe._xcfe.transition(target_phase)
        else:
            # Fallback: direct phase set
            pe._set_phase(target_phase)
    except XCFEViolation as e:
        return err(str(e))

    return ok({
        "verb": "phase_transition",
        "transitioned_to": Phase(target_phase).name if hasattr(Phase(target_phase), 'name') else str(target_phase),
        "current_phase": pe.current_phase.name if hasattr(pe.current_phase, 'name') else str(pe.current_phase),
        "trace_count": len(pe.trace),
    })


def cmd_phase_dispatch(glyph: str) -> str:
    """Dispatch a glyph operation through the phase engine."""
    try:
        from phase_engine import PhaseEngine
    except ImportError as e:
        return err(f"phase_engine import failed: {e}")

    pe = PhaseEngine(strict=False, log=False)
    # Must be in Sek or later to dispatch
    # We create a new engine — for a stateless query, just show what would happen
    supported = sorted(pe.glyphs()) if hasattr(pe, 'glyphs') and callable(pe.glyphs) else []

    if glyph not in supported:
        return ok({
            "verb": "phase_dispatch",
            "glyph": glyph,
            "available": False,
            "supported_glyphs": supported,
            "note": f"Glyph '{glyph}' not registered. Use one of the supported glyphs above.",
        })

    return ok({
        "verb": "phase_dispatch",
        "glyph": glyph,
        "available": True,
        "supported_glyphs": supported,
        "note": f"Glyph '{glyph}' is registered. Call with actual tensor data from a persistent PhaseEngine session.",
    })


# ═══════════════════════════════════════════════════════════════════════════
# XCFE verbs
# ═══════════════════════════════════════════════════════════════════════════

def cmd_xcfe_validate(sequence: str) -> str:
    """Validate a phase sequence against XCFE algebra."""
    try:
        from xcfe import XCFEPlane, XCFEViolation, Phase, PHASE_NAMES
    except ImportError as e:
        return err(f"xcfe import failed: {e}")

    phase_map = {
        "pop": Phase.POP, "wo": Phase.WO, "yax": Phase.YAX,
        "sek": Phase.SEK, "chen": Phase.CHEN, "ch'en": Phase.CHEN, "xul": Phase.XUL
    }

    tokens = [t.strip().lower() for t in sequence.replace(",", " ").split()]
    phases = []
    for t in tokens:
        if t in phase_map:
            phases.append(phase_map[t])
        else:
            return err(f"Unknown phase token '{t}' in sequence. Valid: pop, wo, yax, sek, chen, xul")

    xcfe = XCFEPlane(strict=True)
    results = []
    violations = []
    for target in phases[1:]:  # skip first (starting phase)
        from_name = PHASE_NAMES.get(xcfe.phase, str(xcfe.phase))
        to_name = PHASE_NAMES.get(target, str(target))
        try:
            ok_transition = xcfe.transition(target)
            results.append({
                "from": from_name,
                "to": to_name,
                "legal": True,
                "loop": xcfe.loops > 0 and results and results[-1].get("to") == "Wo"
            })
        except XCFEViolation as e:
            violations.append(str(e))
            results.append({
                "from": from_name,
                "to": to_name,
                "legal": False,
                "error": str(e),
            })
            if xcfe._strict:
                break

    return ok({
        "verb": "xcfe_validate",
        "sequence": [PHASE_NAMES.get(p, str(p)) for p in phases],
        "valid": len(violations) == 0,
        "steps": results,
        "violations": violations,
        "loops": xcfe.loops,
    })


def cmd_xcfe_iterate(cycles: int = 1) -> str:
    """Simulate XCFE training iterations (Ch'en → Wo back-edges)."""
    try:
        from xcfe import XCFEPlane, Phase, PHASE_NAMES
    except ImportError as e:
        return err(f"xcfe import failed: {e}")

    xcfe = XCFEPlane(strict=False)
    steps_log = []
    # Build a full cycle: Pop → Wo → Sek → Ch'en → (Wo → Sek → Ch'en) × cycles → Xul
    full_route = [Phase.WO, Phase.SEK, Phase.CHEN]
    for _ in range(cycles):
        for p in full_route:
            xcfe.transition(p)
            steps_log.append(PHASE_NAMES.get(p, str(p)))

    xcfe.transition(Phase.XUL)
    steps_log.append("Xul")

    return ok({
        "verb": "xcfe_iterate",
        "cycles": cycles,
        "total_loops": xcfe.loops,
        "final_phase": PHASE_NAMES.get(xcfe.phase, str(xcfe.phase)),
        "history": [PHASE_NAMES.get(p, str(p)) for p in xcfe.history],
        "steps": steps_log,
    })


# ═══════════════════════════════════════════════════════════════════════════
# Runtime info verbs
# ═══════════════════════════════════════════════════════════════════════════

def cmd_runtime_spec(section: str = "") -> str:
    """Read spec.toml, optionally filtered to a section."""
    spec = read_spec()
    if spec is None:
        return err(f"spec.toml not found at {_SPEC_PATH}")
    if section:
        section_key = section.strip()
        if section_key in spec:
            return ok({"verb": "runtime_spec", "section": section_key, "spec": spec[section_key]})
        # try dot-notation: "tunnel.routes" -> nested
        parts = section_key.split(".")
        current = spec
        for p in parts:
            if isinstance(current, dict) and p in current:
                current = current[p]
            else:
                return err(f"Section '{section_key}' not found. Available: {', '.join(sorted(spec.keys()))}")
        return ok({"verb": "runtime_spec", "section": section_key, "spec": current})
    return ok({"verb": "runtime_spec", "sections": list(spec.keys()), "spec": spec})


def cmd_runtime_services() -> str:
    """List all services with ports from spec.toml."""
    spec = read_spec()
    if spec is None:
        return err(f"spec.toml not found at {_SPEC_PATH}")

    services = {}
    for key, val in spec.items():
        if key.startswith("services."):
            name = key.split(".", 1)[1]
            services[name] = val
        if key == "transport":
            services["_transport"] = val

    return ok({
        "verb": "runtime_services",
        "services": services,
    })


def cmd_runtime_endpoints() -> str:
    """List all transport endpoints from spec.toml + hardcoded routes."""
    spec = read_spec()
    transport = spec.get("transport", {}) if spec else {}

    endpoints = {
        "llama_server (chat/inference)": transport.get("llama_server", "http://127.0.0.1:8085"),
        "MCP Node (this server)": transport.get("mcp_node", "http://127.0.0.1:3001/sse"),
        "MCP Java": transport.get("mcp_java", "http://127.0.0.1:8087/sse"),
        "Java Server (HTTP proxy)": transport.get("java_server", "http://127.0.0.1:8082"),
        "Auth Server": transport.get("auth_server", "http://127.0.0.1:8086"),
        "JSON Runtime (XCFE API)": transport.get("json_runtime", "http://127.0.0.1:9000"),
        "Object Server (WGSL GPU)": "http://127.0.0.1:8084",
    }

    # Add tunnel routes
    tunnel_routes = spec.get("tunnel.routes", spec.get("tunnel", {}).get("routes", {})) if spec else {}
    for domain, target in tunnel_routes.items():
        if isinstance(target, str):
            endpoints[f"Tunnel: {domain}"] = target

    return ok({
        "verb": "runtime_endpoints",
        "endpoints": endpoints,
    })


# ═══════════════════════════════════════════════════════════════════════════
# GPU / Infra verbs
# ═══════════════════════════════════════════════════════════════════════════

def cmd_gpu_status() -> str:
    """Probe iGPU via wgpu-py — Intel HD 4600 status."""
    try:
        import wgpu
        adapter = wgpu.gpu.request_adapter(power_preference="low-power")
        props = adapter.request_adapter_info()
        return ok({
            "verb": "gpu_status",
            "adapter_found": True,
            "vendor": props.get("vendor_name", "unknown"),
            "architecture": props.get("architecture", "unknown"),
            "device": props.get("name", "unknown"),
            "driver": props.get("driver", "unknown"),
            "backend_type": str(props.get("backend_type", "unknown")),
            "features": sorted(str(f) for f in adapter.features) if hasattr(adapter, 'features') else [],
        })
    except Exception as e:
        return ok({
            "verb": "gpu_status",
            "adapter_found": False,
            "error": str(e),
            "note": "wgpu-py probe failed — GPU may be unavailable or driver not loaded. Expected on headless/CI.",
        })


def cmd_dispatch_priority() -> str:
    """Show dispatch priority order from spec.toml."""
    spec = read_spec()
    if spec is None:
        return err(f"spec.toml not found at {_SPEC_PATH}")

    dispatch = spec.get("dispatch", {})
    priority = dispatch.get("priority", [])
    # Sub-sections are stored under dotted keys (e.g. "dispatch.scxq2_ops")
    scxq2_ops = spec.get("dispatch.scxq2_ops", spec.get("scxq2_ops", {}))
    wgsl_fwd = spec.get("dispatch.wgsl_fwd_ops", spec.get("wgsl_fwd_ops", {}))
    wgsl_bwd = spec.get("dispatch.wgsl_bwd_ops", spec.get("wgsl_bwd_ops", {}))
    cpu_ops = spec.get("dispatch.cpu_dll_ops", spec.get("cpu_dll_ops", {}))

    return ok({
        "verb": "dispatch_priority",
        "priority_order": priority if isinstance(priority, list) else [],
        "scxq2_ops": dict(scxq2_ops),
        "wgsl_forward_ops": dict(wgsl_fwd),
        "wgsl_backward_ops": dict(wgsl_bwd),
        "cpu_dll_ops": dict(cpu_ops),
    })


def cmd_object_server_health() -> str:
    """Check object server /health on port 8084 (or configured port)."""
    import urllib.request
    import urllib.error
    url = "http://127.0.0.1:8084/health"
    try:
        resp = urllib.request.urlopen(url, timeout=3)
        body = resp.read().decode("utf-8")
        data = json.loads(body) if body.strip() else {}
        return ok({
            "verb": "object_server_health",
            "server": url,
            "reachable": True,
            "status": resp.status,
            "data": data,
        })
    except urllib.error.URLError as e:
        return ok({
            "verb": "object_server_health",
            "server": url,
            "reachable": False,
            "error": str(e.reason),
            "note": "Object server (object_server.py) may not be running. Start with: python kuhul/object_server.py",
        })
    except Exception as e:
        return ok({
            "verb": "object_server_health",
            "server": url,
            "reachable": False,
            "error": str(e),
        })


def cmd_runtime_status() -> str:
    """Aggregated runtime status with links to all services."""
    # Collect data from other verbs
    spec = read_spec()
    phase_result = cmd_phase_status()
    phase_data = json.loads(phase_result) if phase_result else {}

    transport = spec.get("transport", {}) if spec else {}
    services_section = {k: v for k, v in (spec or {}).items() if k.startswith("services.")}

    links = {
        "llama_server": transport.get("llama_server", "http://127.0.0.1:8085"),
        "mcp_node": transport.get("mcp_node", "http://127.0.0.1:3001/sse"),
        "mcp_java": transport.get("mcp_java", "http://127.0.0.1:8087/sse"),
        "java_server": transport.get("java_server", "http://127.0.0.1:8082"),
        "json_runtime": transport.get("json_runtime", "http://127.0.0.1:9000"),
        "object_server": "http://127.0.0.1:8084",
        "auth_server": transport.get("auth_server", "http://127.0.0.1:8086"),
        "kuhul.dev (tunnel)": "https://kuhul.dev",
        "api.kuhul.dev (MCP)": "https://api.kuhul.dev/sse",
        "micronautai.com (tunnel)": "https://micronautai.com",
    }

    return ok({
        "verb": "runtime_status",
        "phase": phase_data.get("current_phase", "unknown"),
        "spec_version": spec.get("runtime", {}).get("version", "unknown") if spec else "unknown",
        "phase_order": spec.get("runtime", {}).get("phase_order", []) if spec else [],
        "services": services_section,
        "links": links,
        "file_surface": {
            "spec_toml": str(_SPEC_PATH),
            "phase_engine": str(_HERE / "phase_engine.py"),
            "xcfe": str(_HERE / "xcfe.py"),
            "gpu_lanes_fwd": str(_HERE / "ggml_wgsl_lanes.py"),
            "gpu_lanes_bwd": str(_HERE / "ggml_wgsl_lanes_back.py"),
            "object_server": str(_HERE / "object_server.py"),
            "spec_file": str(_SPEC_PATH),
        },
    })


# ═══════════════════════════════════════════════════════════════════════════
# Main dispatcher
# ═══════════════════════════════════════════════════════════════════════════

def main():
    if len(sys.argv) < 2:
        print(err("Usage: python kuhul_runtime_bridge.py <verb> [args...]"))
        sys.exit(1)

    verb = sys.argv[1]
    args = sys.argv[2:]

    dispatch = {
        "phase_status": lambda: cmd_phase_status(),
        "phase_transition": lambda: cmd_phase_transition(args[0]) if args else err("phase_transition requires a phase name (pop/wo/yax/sek/chen/xul)"),
        "phase_dispatch": lambda: cmd_phase_dispatch(args[0]) if args else err("phase_dispatch requires a glyph name"),
        "xcfe_validate": lambda: cmd_xcfe_validate(args[0]) if args else err("xcfe_validate requires a phase sequence (e.g. 'pop wo sek')"),
        "xcfe_iterate": lambda: cmd_xcfe_iterate(int(args[0]) if args else 1),
        "runtime_spec": lambda: cmd_runtime_spec(args[0] if args else ""),
        "runtime_services": lambda: cmd_runtime_services(),
        "runtime_endpoints": lambda: cmd_runtime_endpoints(),
        "gpu_status": lambda: cmd_gpu_status(),
        "dispatch_priority": lambda: cmd_dispatch_priority(),
        "object_server_health": lambda: cmd_object_server_health(),
        "runtime_status": lambda: cmd_runtime_status(),
    # MX-2 brain verbs
    "brain_inspect": lambda: cmd_brain_inspect(),
    "brain_query_intent": lambda: cmd_brain_query_intent(args[0]) if args else err("brain_query_intent requires a query string"),
    "brain_query_profiles": lambda: cmd_brain_query_profiles(args[0]) if args else err("brain_query_profiles requires a query string"),
    "brain_query_ngrams": lambda: cmd_brain_query_ngrams(args[0], args[1]) if len(args) >= 2 else err("brain_query_ngrams requires ngram_type and term"),
    "brain_read": lambda: cmd_brain_read(args[0]) if args else err("brain_read requires a brain id"),
    }

    handler = dispatch.get(verb)
    if handler is None:
        print(err(f"Unknown verb '{verb}'. Valid: {', '.join(sorted(dispatch.keys()))}"))
        sys.exit(1)

    result = handler()
    print(result)


if __name__ == "__main__":
    main()
