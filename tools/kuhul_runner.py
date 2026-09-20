"""
kuhul_runner.py — K'UHUL program interpreter.

Reads .kuhul shell files and .khl kernel files, validates phase transitions
through XCFE, and executes them through the object server or local backends.

Usage:
    python -m kuhul.kuhul_runner run file.kuhul       # Execute a shell file
    python -m kuhul.kuhul_runner run file.khl          # Execute a kernel file  
    python -m kuhul.kuhul_runner compile file.klsl     # Compile KLSL to WGSL
    python -m kuhul.kuhul_runner check file.kuhul      # Validate phases via XCFE
    python -m kuhul.kuhul_runner repl                  # Interactive REPL

Output:
    --isa        Emit JSON ISA instruction trace
    --xcfe       Emit XCFE state transition log
    -o <dir>     Write output files (.kuhul, .json)
"""

from __future__ import annotations

import argparse
import io
import json
import os
import pathlib
import re
import sys
import time
import traceback
from typing import Any, Optional

# Force UTF-8 stdout (cp1252 can't print K'UHUL unicode phase names)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# pi-cycle engine
try:
    from kuhul.pi_cycle import PiCycleGraph
    _HAS_PI_CYCLE = True
except ImportError:
    PiCycleGraph = None  # type: ignore
    _HAS_PI_CYCLE = False


_HERE = pathlib.Path(__file__).parent
_DEFAULT_MANIFEST = _HERE.parent / "server.wgsl.json"
_OBJECT_SERVER_URL = "http://127.0.0.1:9070"


# ---------------------------------------------------------------------------
# .kuhul shell file parser
# ---------------------------------------------------------------------------

class KuhulShellParser:
    """
    Parser for .kuhul shell files.

    Handles the bracket-phase format:
        [Pop name]
          [Wo action]→[Ch'en result]
          [Sek op]→[Ch'en output]
        [Xul]

        fn name(args) @effect: type @bind: path
    """

    PHASES = {"Pop", "Wo", "Yax", "Sek", "Ch'en", "Xul"}

    # Phase name pattern — \w+ but includes right-quote for Ch'en
    _PHASE_RE = re.compile(r"^\[([\w\u2019\x27]+)\s*(.*?)\]$")

    def __init__(self, source: str):
        self._source = source
        self._lines = source.split("\n")
        self._phase_blocks: list[dict] = []
        self._functions: list[dict] = []
        self._pi_graph = PiCycleGraph() if _HAS_PI_CYCLE else None
        self._parse()
        # Parse pi-cycles from source
        if self._pi_graph is not None:
            self._pi_graph.parse(source)

    def _parse(self):
        current_block: Optional[dict] = None
        in_function = False
        fn_buffer: list[str] = []

        # Track whether we can parse a phase declaration
        # Phase declarations only at outer level (column 0 or after blank line)
        can_declare_phase = True

        for line in self._lines:
            stripped = line.strip()

            # Skip empty and comments
            if not stripped or stripped.startswith("//"):
                continue
            if stripped.startswith("/*"):
                in_comment = True
                continue
            if "*/" in stripped:
                in_comment = False
                continue
            if stripped.startswith("#"):
                continue

            # Phase block start: only at column 0 (outer level)
            # e.g. "[Pop name]" at start of line, NOT indented "[Wo ...]"
            col = len(line) - len(line.lstrip()) if not stripped.startswith("//") else 99
            phase_match = self._PHASE_RE.match(stripped)
            if phase_match and col == 0:
                name = phase_match.group(1)
                body = phase_match.group(2).strip()
                if name in self.PHASES:
                    current_block = {
                        "phase": name,
                        "body": body,
                        "children": [],
                        "line": stripped,
                    }
                    self._phase_blocks.append(current_block)
                    can_declare_phase = False
                    continue

            # Transition: [Sek op]→[Ch'en result]
            trans_match = re.match(r'^(\[.*?\])(?:→(\[.*?\]))+$', stripped)
            if trans_match:
                parts = re.findall(r'\[([^\]]+)\]', stripped)
                if current_block is not None:
                    current_block["children"].append({
                        "type": "transition",
                        "steps": parts,
                        "line": stripped,
                    })
                continue

            # Single transition: action→result
            arrow_match = re.match(r'^(\[[^\]]+\])(?:→(\[[^\]]+\]))+$', stripped)
            if arrow_match:
                parts = re.findall(r'\[([^\]]+)\]', stripped)
                if current_block is not None:
                    current_block["children"].append({
                        "type": "transition",
                        "steps": parts,
                        "line": stripped,
                    })
                continue

            # Plain step inside block
            step_match = re.match(r'^\[([^\]]+)\]$', stripped)
            if step_match and current_block is not None:
                current_block["children"].append({
                    "type": "step",
                    "value": step_match.group(1),
                    "line": stripped,
                })
                continue

            # Arrow transition without brackets
            if "→" in stripped and not stripped.startswith("//"):
                parts = [p.strip() for p in stripped.split("→")]
                if current_block is not None:
                    current_block["children"].append({
                        "type": "transition",
                        "steps": parts,
                        "line": stripped,
                    })
                continue

            # Function definition: fn name(args) @effect: type @bind: path
            fn_match = re.match(r'^fn\s+(\w+)\s*\((.*?)\)\s*(.*)$', stripped)
            if fn_match:
                fn_name = fn_match.group(1)
                fn_args = fn_match.group(2)
                fn_attrs = fn_match.group(3)
                effect_m = re.search(r'@effect:\s*(\S+)', fn_attrs)
                bind_m = re.search(r'@bind:\s*(\S+)', fn_attrs)
                self._functions.append({
                    "name": fn_name,
                    "args": [a.strip() for a in fn_args.split(",") if a.strip()],
                    "effect": effect_m.group(1) if effect_m else None,
                    "bind": bind_m.group(1) if bind_m else None,
                    "line": stripped,
                })
                continue

    @property
    def phase_blocks(self) -> list[dict]:
        return self._phase_blocks

    @property
    def functions(self) -> list[dict]:
        return self._functions

    def phases_used(self) -> list[str]:
        return [b["phase"] for b in self._phase_blocks]

    def has_pi_cycles(self) -> bool:
        """Whether pi-cycles were parsed."""
        return self._pi_graph is not None and len(self._pi_graph.names()) > 0

    def pi_cycle_names(self) -> list[str]:
        return list(self._pi_graph.names()) if self._pi_graph else []

    def evaluate_pi_cycles(self, x=0.0, y=0.0, t=0.0):
        """Evaluate all pi-cycles and return values dict."""
        if self._pi_graph is None:
            return {}
        return self._pi_graph.evaluate(x=x, y=y, t=t)


# ---------------------------------------------------------------------------
# .khl kernel file parser
# ---------------------------------------------------------------------------

class KuhlKernelParser:
    """Minimal .khl parser — extracts glyph definitions and op blocks."""

    def __init__(self, source: str):
        self._glyphs: list[dict] = []
        self._ops: list[dict] = []
        self._bindings: list[str] = []
        self._parse(source)

    def _parse(self, source: str):
        for line in source.split("\n"):
            stripped = line.strip()
            if not stripped or stripped.startswith("/*") or stripped.startswith("//"):
                continue

            bind_m = re.match(r'^@bind\s+(\S+)', stripped)
            if bind_m:
                self._bindings.append(bind_m.group(1))
                continue

            glyph_m = re.match(r'^glyph\s+(\S+)\s*→', stripped)
            if glyph_m:
                self._glyphs.append({"name": glyph_m.group(1), "line": stripped})
                continue

            op_m = re.match(r'^op\s+(\S+)\s*\(', stripped)
            if op_m:
                self._ops.append({"name": op_m.group(1), "line": stripped})
                continue

    @property
    def glyphs(self) -> list[dict]: return self._glyphs
    @property
    def ops(self) -> list[dict]: return self._ops
    @property
    def bindings(self) -> list[str]: return self._bindings


# ---------------------------------------------------------------------------
# XCFE validator
# ---------------------------------------------------------------------------

def validate_phases(phases: list[str]) -> list[dict]:
    """Validate phase transitions through XCFE. Returns transition log."""
    import kuhul.xcfe as xcfe

    plane = xcfe.XCFEPlane(strict=True)
    log = []

    log.append({
        "from": "INIT",
        "to": phases[0] if phases else "NONE",
        "legal": phases[0] == "Pop" if phases else False,
        "state": plane.state(),
    })

    for i in range(len(phases) - 1):
        from_p = phases[i].upper().replace("'", "").replace("\u2019", "")
        to_p = phases[i + 1].upper().replace("'", "").replace("\u2019", "")
        try:
            phase_enum = getattr(xcfe.Phase, from_p, None)
            to_enum = getattr(xcfe.Phase, to_p, None)
            if phase_enum is None or to_enum is None:
                log.append({"from": from_p, "to": to_p, "legal": False, "error": f"Unknown phase"})
                continue
            plane.transition(to_enum)
            log.append({
                "from": from_p,
                "to": to_p,
                "legal": True,
                "loops": plane.loops,
                "state": plane.state(),
            })
        except xcfe.XCFEViolation as e:
            log.append({
                "from": from_p,
                "to": to_p,
                "legal": False,
                "error": str(e),
                "legal_next": sorted(plane.legal_next(), key=lambda p: xcfe.PHASE_ORDER.index(p)),
            })

    return log


# ---------------------------------------------------------------------------
# Object server client
# ---------------------------------------------------------------------------

class ObjectServerClient:
    """HTTP client for the WGSL object server."""

    def __init__(self, base_url: str = _OBJECT_SERVER_URL):
        self._base = base_url.rstrip("/")
        self._healthy = False

    def health(self) -> dict | None:
        import urllib.request
        try:
            resp = urllib.request.urlopen(
                urllib.request.Request(f"{self._base}/health"), timeout=5)
            return json.loads(resp.read())
        except Exception:
            return None

    def dispatch(self, opcode: int, tensors: dict) -> dict | None:
        import urllib.request, base64
        body = json.dumps({"opcode": opcode, "tensors": tensors}).encode("utf-8")
        try:
            req = urllib.request.Request(
                f"{self._base}/dispatch", data=body,
                headers={"Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=30)
            return json.loads(resp.read())
        except Exception as e:
            return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# K'UHUL program executor
# ---------------------------------------------------------------------------

class KuhulExecutor:
    """
    Executes a parsed .kuhul program.

    Phase mapping:
        Pop  → Initialize, validate
        Wo   → Allocate, load data
        Sek  → Dispatch compute
        Ch'en → Store/readback results
        Xul  → Finalize, emit output
    """

    def __init__(self, parser: KuhulShellParser, client: ObjectServerClient | None = None):
        self._parser = parser
        self._client = client or ObjectServerClient()
        self._results: dict[str, Any] = {}
        self._trace: list[dict] = []
        self._state: dict[str, Any] = {"phase": "Init"}

    def execute(self) -> dict:
        """Run through all phase blocks."""
        import kuhul.xcfe as xcfe

        plane = xcfe.XCFEPlane(strict=False)
        phases = self._parser.phases_used()

        if self._parser.has_pi_cycles():
            pi_names = self._parser.pi_cycle_names()
            print(f"\n  [KUHUL] Executing {len(phases)} phases, "
                  f"{len(self._parser.functions)} functions, "
                  f"{len(pi_names)} pi-cycles...\n")
            pi_vals = self._parser.evaluate_pi_cycles()
            for name in pi_names[:4]:
                val = pi_vals.get(name, 0.0)
                print(f"    pi-cycle: {name} = {val:.4f}")
            if len(pi_names) > 4:
                print(f"    ... +{len(pi_names)-4} more")
        else:
            print(f"\n  [KUHUL] Executing {len(phases)} phases, "
                  f"{len(self._parser.functions)} functions...\n")

        for block in self._parser.phase_blocks:
            phase = block["phase"]
            body = block["body"]
            children = block["children"]

            is_first = phase == phases[0]
            if not is_first:
                try:
                    # Normalize phase name (Ch'en -> CHEN for enum lookup)
                    phase_upper = phase.upper().replace("'", "").replace("\u2019", "")
                    to_enum = getattr(xcfe.Phase, phase_upper)
                    if not plane.can_transition(to_enum):
                        print(f"  [XCFE] ILLEGAL: {plane.state()['phase']} -> {phase}")
                        self._trace.append({"error": "illegal", "phase": phase})
                        continue
                    plane.transition(to_enum)
                except Exception as e:
                    print(f"  [XCFE] {e}")

            display_phase = phase.replace("'", "'")
            print(f"  [{display_phase}] {body}" if body else f"  [{display_phase}]")

            for child in children:
                self._execute_child(child, phase)

            if phase == "Ch'en":
                print(f"         -> committed ({len(self._results)} results)")
            elif phase == "Xul":
                print(f"         -> terminal")

        self._state = plane.state()
        return {"results": self._results, "trace": self._trace, "state": self._state}

    def _execute_child(self, child: dict, parent_phase: str):
        ctype = child["type"]
        line = child.get("line", "")

        if ctype == "step":
            self._trace.append({"phase": parent_phase, "action": child["value"]})
            # Check if action maps to a known function
            for fn in self._parser.functions:
                if fn["name"] == child["value"] or child["value"].startswith(fn["name"]):
                    self._call_function(fn, child["value"])
                    return

        elif ctype == "transition":
            steps = child["steps"]
            for step in steps:
                self._trace.append({"phase": parent_phase, "step": step})
            # For GPU dispatches: Sek action → Ch'en output
            if len(steps) >= 2 and "Sek" in str(steps[0]):
                self._try_gpu_dispatch(steps)

    def _call_function(self, fn: dict, invocation: str):
        effect = fn.get("effect")
        bind = fn.get("bind")
        print(f"           fn {fn['name']}({', '.join(fn['args'])}) "
              f"@effect:{effect} @bind:{bind}")

        # If it's a GPU-bound function, try the object server
        if effect in ("gpu", "compute", "inference"):
            self._try_gpu_dispatch([invocation, "result"])
            return

        self._results[fn["name"]] = {"effect": effect, "bind": bind, "status": "recognized"}

    def _try_gpu_dispatch(self, steps: list):
        """Try to dispatch through the object server's manifest."""
        # Check if the server is live
        h = self._client.health()
        if not h or not h.get("ok"):
            print(f"           (object server unavailable — skipping GPU dispatch)")
            self._trace.append({"warning": "object server not available"})
            return

        # Look up the opcode in the manifest by matching keywords in the step
        import urllib.request
        try:
            req = urllib.request.Request(f"{self._client._base}/manifest")
            resp = urllib.request.urlopen(req, timeout=5)
            manifest = json.loads(resp.read())
            ops = manifest.get("manifest", {}).get("ops", [])
        except Exception:
            ops = []

        matched = []
        for step in steps:
            step_str = str(step)
            for op in ops:
                if op["name"].lower() in step_str.lower() or \
                   op.get("description", "").lower() in step_str.lower():
                    matched.append(op)
                    break

        if matched:
            for op in matched:
                print(f"           -> GPU op {op['name']} (0x{op['opcode']:08X})")
                self._trace.append({"gpu_dispatch": op["name"], "opcode": op["opcode"]})
        else:
            probe = steps[0].replace("[", "").replace("]", "").split()[0]
            print(f"           -> GPU dispatch: {probe} (routed by name)")
            self._trace.append({"gpu_dispatch": probe, "opcode": "unknown"})


# ---------------------------------------------------------------------------
# REPL
# ---------------------------------------------------------------------------

def repl():
    """Interactive K'UHUL REPL."""
    import kuhul.xcfe as xcfe

    plane = xcfe.XCFEPlane(strict=False)
    client = ObjectServerClient()
    print()
    print("  K'UHUL REPL v1.0")
    print("  Commands: phase <name>, glyph, status, exit")
    print(f"  Phases: {' '.join(xcfe.PHASE_NAMES[p] for p in xcfe.PHASE_ORDER)}")
    print()

    while True:
        try:
            line = input("  > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n  [Xul]")
            break

        if not line:
            continue
        if line in ("exit", "quit", "xul"):
            print("  [Xul]")
            break

        if line.startswith("phase "):
            pname = line.split(None, 1)[1].strip().lower().capitalize()
            pname = pname.replace("'", "'")
            try:
                to_enum = getattr(xcfe.Phase, pname.upper().replace("'", ""))
                if plane.can_transition(to_enum):
                    plane.transition(to_enum)
                    s = plane.state()
                    print(f"  [{s['phase']}] legal_next={s['legal_next']}")
                else:
                    s = plane.state()
                    print(f"  ILLEGAL: {s['phase']} -> {pname}")
                    print(f"  Legal from {s['phase']}: {s['legal_next']}")
            except AttributeError:
                print(f"  Unknown phase: {pname}")

        elif line == "glyph":
            print("  glyph characters: ⏣ ⊗ ⟁ ⟁ ⚡ → ◇ ● ○ ◆")
            print("  glyph syntax:    ⟁Wo⟁ ⟁Sek⟁ ⟁Ch'en⟁ ⟁Yax⟁ ⟁Xul⟁")

        elif line == "status":
            h = client.health()
            if h:
                print(f"  Server: {h.get('registered_ops')} ops, "
                      f"uptime={h.get('uptime_sec', 0):.0f}s")
            else:
                print("  Server: not available")
            s = plane.state()
            print(f"  Phase: {s['phase']}, loops={s['loops']}, depth={s['depth']}")

        elif line == "help":
            print("  Commands:")
            print("    phase <name>   — transition to a phase")
            print("    glyph           — show glyph characters")
            print("    status          — show system status")
            print("    exit            — exit REPL")

        else:
            print(f"  Unknown: {line}. Try 'help'.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="K'UHUL program interpreter")
    sub = parser.add_subparsers(dest="command", required=True)

    # run
    run_p = sub.add_parser("run", help="Execute a .kuhul or .khl file")
    run_p.add_argument("file", help="Path to .kuhul or .khl file")
    run_p.add_argument("--isa", action="store_true", help="Emit JSON ISA trace")
    run_p.add_argument("--xcfe", action="store_true", help="Emit XCFE transition log")
    run_p.add_argument("-o", "--output", help="Output directory")

    # compile
    comp_p = sub.add_parser("compile", help="Compile KLSL to WGSL")
    comp_p.add_argument("file", help="Path to .klsl file")
    comp_p.add_argument("-o", "--output", help="Output path for WGSL")

    # check
    check_p = sub.add_parser("check", help="Validate phase transitions via XCFE")
    check_p.add_argument("file", help="Path to .kuhul or .khl file")

    # repl
    sub.add_parser("repl", help="Interactive REPL")

    args = parser.parse_args()

    if args.command == "repl":
        repl()
        return

    # Read the input file
    file_path = pathlib.Path(args.file)
    if not file_path.exists():
        print(f"File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    source = file_path.read_text(encoding="utf-8")

    if args.command == "compile":
        from kuhul import klsl_wgsl_emitter
        wgsl = klsl_wgsl_emitter.emit_wgsl(source)
        out_path = args.output or file_path.with_suffix(".wgsl")
        pathlib.Path(out_path).write_text(wgsl, encoding="utf-8")
        print(f"Compiled {file_path.name} -> {out_path} ({len(wgsl)} chars)")
        return

    if args.command == "check":
        if file_path.suffix in (".kuhul", ".kuhul"):
            p = KuhulShellParser(source)
            phases = p.phases_used()
            log = validate_phases(phases)
            print(f"\n  Phase check for {file_path.name}:")
            print(f"  {len(phases)} phases: {' -> '.join(phases)}\n")
            if p.has_pi_cycles():
                print(f"  pi-cycles: {', '.join(p.pi_cycle_names())}\n")
            for entry in log:
                mark = "PASS" if entry.get("legal") else "FAIL"
                print(f"  [{mark}] {entry.get('from','?')} -> {entry.get('to','?')}")
                if not entry.get("legal") and "error" in entry:
                    print(f"        {entry['error']}")
        else:
            p = KuhlKernelParser(source)
            print(f"\n  Kernel check for {file_path.name}:")
            print(f"  {len(p.glyphs)} glyphs, {len(p.ops)} ops, {len(p.bindings)} bindings")
            for g in p.glyphs:
                print(f"    glyph {g['name']}")
            for o in p.ops:
                print(f"    op    {o['name']}")
        return

    if args.command == "run":
        if file_path.suffix == ".khl":
            p = KuhlKernelParser(source)
            print(f"  K'UHUL Kernel: {len(p.glyphs)} glyphs, {len(p.ops)} ops")
            print(f"  Bindings: {p.bindings}")
            print("  (kernel parsing — execution not yet implemented for .khl)")
        else:
            p = KuhulShellParser(source)
            client = ObjectServerClient()
            executor = KuhulExecutor(p, client)
            result = executor.execute()

        # Emit outputs
        if args.isa:
            isa_path = pathlib.Path(args.output or ".") / "isa_trace.json"
            isa_path.parent.mkdir(parents=True, exist_ok=True)
            isa_path.write_text(json.dumps(result.get("trace", []), indent=2))
            print(f"\n  [ISA trace] -> {isa_path}")

        if args.xcfe:
            xcfe_path = pathlib.Path(args.output or ".") / "xcfe_log.json"
            xcfe_path.parent.mkdir(parents=True, exist_ok=True)
            log = validate_phases(p.phases_used())
            xcfe_path.write_text(json.dumps(log, indent=2))
            print(f"  [XCFE log]  -> {xcfe_path}")

        return


if __name__ == "__main__":
    main()
