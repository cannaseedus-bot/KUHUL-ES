"""
phase_engine.py — K'UHUL Phase Engine

Wraps GlyphBufferEngine with K'UHUL phase-gated execution.

State machine (PHASE_ORDER index drives advance, never the hex value):
    Pop(0x80) → Wo(0x81) → Sek(0x82) → Ch'en(0x88) → Xul(0x83)

Each phase gates which operations can execute:
    Pop   — observe only (no dispatch)
    Wo    — alloc named buffers
    Sek   — dispatch elementwise lanes + matmul + GPU ops
    Ch'en — commit named outputs
    Xul   — terminate, flush ASXRAM trace

Violations raise PhaseGateError (or log + continue with strict=False).
All transitions and dispatches are appended to .asx_memory.events.jsonl.

Dispatch routing (all through .dispatch() or named convenience methods):

  CPU lanes (native DLL):
    dispatch("+"|"-"|"*"|"/", a, b)  → WO_ADD / SUB / MUL / DIV
    dispatch("silu"|"gelu", a)       → WO_SILU / WO_GELU
    .matmul(a, b)                    → WO_MATMUL (separate — different arity)

  GPU lanes — ggml WGSL shaders (dispatched through dispatch() or execute_*):
    dispatch("swiglu", a, b)         → glu.wgsl  OP_SWIGLU
    dispatch("geglu", a, b)          → glu.wgsl  OP_GEGLU
    dispatch("geglu_erf", a, b)      → glu.wgsl  OP_GEGLU_ERF
    dispatch("rms_norm", src)        → row_norm.wgsl  RMS_NORM
    dispatch("softmax", src)         → soft_max.wgsl

  GPU lanes — custom shaders (named methods only):
    .execute_pi_field(...)           → pi_field_shader.wgsl (graph diffusion)
    .execute_wave(sh, dt, steps=1)   → optical_wave.wgsl   (SH wave ping-pong)

Public API
----------
PhaseEngine(glyph_engine=None, strict=True, log=True)
    .pop()                          → enter Pop phase
    .wo()                           → enter Wo phase
    .sek()                          → enter Sek phase
    .chen()                         → enter Ch'en phase
    .xul()                          → enter Xul phase, returns commit dict

    .observe(name, value)           → Pop: snapshot named value
    .alloc(name, data)              → Wo:  register named numpy array
    .dispatch(glyph, a, b=None)     → Sek: CPU or GPU WGSL lane by glyph name
    .matmul(a, b)                   → Sek: WO_MATMUL
    .execute_pi_field(...)          → Sek: GPU pi-field diffusion
    .execute_wave(sh, dt, steps=1)  → Sek: GPU SH wave propagation
    .execute_swiglu(a, b)           → Sek: GPU SwiGLU (convenience alias)
    .execute_geglu(a, b, variant)   → Sek: GPU GeGLU / GeGLU_ERF
    .execute_rms_norm(src, eps)     → Sek: GPU RMS normalization
    .execute_softmax(src, scale)    → Sek: GPU softmax
    .commit(name, value)            → Ch'en: store result

    .current_phase                  → Phase enum
    .trace                          → list of event dicts for this cycle
    .stats()                        → summary dict

CLI demo:
    python phase_engine.py
"""

import json
import pathlib
import time
from typing import Any

import numpy as np

# XCFE algebraic control plane — defines Phase, transitions, and XCFEViolation
from xcfe import (
    Phase, PHASE_NAMES, PHASE_ORDER,
    XCFEPlane, XCFEViolation,
    PHASE_CAPABILITIES, OPCODE_PHASE,
)

# ── Paths ─────────────────────────────────────────────────────────────────────
_ASXRAM_LOG = pathlib.Path(__file__).parent.parent / ".asx_memory.events.jsonl"

# ── ASXRAM op names (from asx-project-memory skill contract) ─────────────────
_OP_FOR_PHASE = {
    Phase.POP:  "observe",
    Phase.WO:   "alloc",
    Phase.SEK:  "execute",
    Phase.CHEN: "commit",
    Phase.XUL:  "terminate",
}

# ── Phase gate error ──────────────────────────────────────────────────────────

class PhaseGateError(RuntimeError):
    """Raised when an operation is attempted in the wrong K'UHUL phase."""
    def __init__(self, current: Phase, required: Phase, action: str):
        self.current  = current
        self.required = required
        super().__init__(
            f"PhaseGateError: '{action}' requires phase {PHASE_NAMES[required]} "
            f"but current phase is {PHASE_NAMES[current]}"
        )

# ── Glyph → opcode map (built at runtime from the DLL) ───────────────────────
# Keys: glyph string ("+", "silu", ...), lane name ("WO_ADD", ...),
#       opcode string ("0x02010001"), and special GPU keys ("pi_field", "wave").
# Value: opcode string or "gpu:pi_field" / "gpu:wave".

_GLYPH_MAP: dict[str, str] = {}
_ELEMENTWISE_OPCODES: set[str] = set()   # opcodes safe for execute_f32 (CPU DLL)
_MATMUL_OPCODE = "0x02020000"
_dll_glyphs_built = False  # guard for DLL-side entries only

# WGSL GPU lane dispatch table — populated lazily by _ensure_wgsl_glyphs()
# Maps "gpu:swiglu" → callable(a, b) → np.ndarray
_WGSL_GPU_OPS: dict = {}

# SCXQ2 WGSL backend registered flag (separate from ggml forward/backward lanes)
_scxq2_glyphs_built = False


def _ensure_wgsl_glyphs() -> None:
    """Lazy-import wgsl lane modules and register GPU glyphs into _GLYPH_MAP."""
    global _WGSL_GPU_OPS
    if _WGSL_GPU_OPS:
        return
    import ggml_wgsl_lanes as _wl
    import ggml_wgsl_lanes_back as _bk
    entries = [
        # (glyph aliases,           opcode_key,          dispatch_fn)
        # ── forward ──────────────────────────────────────────────────────────
        (["swiglu",    "WO_SWIGLU",      "0x02000100"], "gpu:swiglu",        lambda a, b: _wl.swiglu(a, b)),
        (["geglu",     "WO_GEGLU",       "0x02000101"], "gpu:geglu",         lambda a, b: _wl.geglu(a, b)),
        (["geglu_erf", "WO_GEGLU_ERF",   "0x02000102"], "gpu:geglu_erf",     lambda a, b: _wl.geglu_erf(a, b)),
        (["rms_norm",  "WO_RMS_NORM",    "0x02000110"], "gpu:rms_norm",      lambda a, b: _wl.rms_norm(a)),
        (["softmax",   "WO_SOFTMAX",     "0x02000120"], "gpu:softmax",       lambda a, b: _wl.softmax(a)),
        # ── backward ─────────────────────────────────────────────────────────
        (["silu_back",          "∇silu",    "WO_SILU_BACK",     "0x02000140"], "gpu:silu_back",         lambda a, b: _bk.silu_back(a, b)),
        (["softmax_back",       "∇softmax", "WO_SOFTMAX_BACK",  "0x02000150"], "gpu:softmax_back",      lambda a, b: _bk.softmax_back(a, b)),
        (["rms_norm_back",      "∇rms",     "WO_RMS_NORM_BACK", "0x02000160"], "gpu:rms_norm_back",     lambda a, b: _bk.rms_norm_back(a, b)),
        (["cross_entropy_back", "∇xe",      "WO_XE_BACK",       "0x02000170"], "gpu:cross_entropy_back",lambda a, b: _bk.cross_entropy_back(a, b)),
        (["gelu_back",          "∇gelu",    "WO_GELU_BACK",     "0x02000180"], "gpu:gelu_back",         lambda a, b: _bk.gelu_back(a, b)),
    ]
    for aliases, opcode, fn in entries:
        for alias in aliases:
            _GLYPH_MAP[alias] = opcode
        _WGSL_GPU_OPS[opcode] = fn


def _ensure_scxq2_glyphs() -> None:
    """
    Register SCXQ2 WGSL ops into _WGSL_GPU_OPS.

    These ops go through scxq2_wgsl_backend — pure WGSL/OpenGL path.
    D3D11 is never touched.

    SCXQ2 matmul takes priority over the CPU DLL matmul: once registered,
    dispatch("matmul", a, b) routes to the GPU instead of the DLL.
    """
    global _WGSL_GPU_OPS, _GLYPH_MAP, _scxq2_glyphs_built
    if _scxq2_glyphs_built:
        return
    import scxq2_wgsl_backend as _sq

    entries = [
        # (aliases,                              opcode_key,          fn)
        # ── tensor ops ───────────────────────────────────────────────────────
        (["matmul", "WO_MATMUL", "⨀",
          "scxq2:matmul", "MATMUL"],            "scxq2:matmul",  lambda a, b: _sq.op_matmul(a, b)),
        (["scxq2:add",    "SCXQ2_ADD"],         "scxq2:add",     lambda a, b: _sq.op_add(a, b)),
        (["scxq2:sub",    "SCXQ2_SUB"],         "scxq2:sub",     lambda a, b: _sq.op_sub(a, b)),
        (["scxq2:mul",    "SCXQ2_MUL"],         "scxq2:mul",     lambda a, b: _sq.op_mul(a, b)),
        (["scxq2:div",    "SCXQ2_DIV"],         "scxq2:div",     lambda a, b: _sq.op_div(a, b)),
        # ── activation lanes (SCXQ2 unary ops) ───────────────────────────────
        (["relu",    "scxq2:relu",  "RELU"],    "scxq2:relu",    lambda a, b: _sq.op_relu(a)),
        (["scxq2:silu"],                        "scxq2:silu",    lambda a, b: _sq.op_silu(a)),
        (["scxq2:gelu"],                        "scxq2:gelu",    lambda a, b: _sq.op_gelu(a)),
    ]
    for aliases, opcode, fn in entries:
        for alias in aliases:
            _GLYPH_MAP[alias] = opcode
        _WGSL_GPU_OPS[opcode] = fn
    _scxq2_glyphs_built = True


def _ensure_glyph_map(engine) -> None:
    global _GLYPH_MAP, _ELEMENTWISE_OPCODES, _dll_glyphs_built
    if _dll_glyphs_built:
        return
    _dll_glyphs_built = True
    for lane in engine.lane_info():
        op  = lane["opcode"]
        m   = {lane["glyph"]: op, lane["name"]: op, op: op}
        _GLYPH_MAP.update(m)
        if op != _MATMUL_OPCODE:        # matmul uses execute_matmul, not execute_f32
            _ELEMENTWISE_OPCODES.add(op)
    # GPU dispatch pseudo-opcodes
    _GLYPH_MAP.update({"pi_field": "gpu:pi_field", "wave": "gpu:wave"})
    # Unicode math glyph aliases (tensor/attention notation)
    _GLYPH_MAP.update({
        # matmul family
        "⨀": _MATMUL_OPCODE,   # ⨀ → matmul (tensor product circle)
        # activation aliases
        "σ": _GLYPH_MAP.get("silu",  ""),   # σ → silu
        "Φ": _GLYPH_MAP.get("gelu",  ""),   # Φ → gelu
        "τ": _GLYPH_MAP.get("tanh",  ""),   # τ → tanh (if loaded)
        # normalization
        "⎁": _GLYPH_MAP.get("rms_norm", ""), # ⌁ → rms_norm
        # attention
        "⟐": _GLYPH_MAP.get("softmax",  ""), # ⟐ → softmax
    })
    # Remove empty-string entries (ops not loaded yet — will resolve at dispatch time)
    _GLYPH_MAP = {k: v for k, v in _GLYPH_MAP.items() if v}
    # WGSL GPU lanes
    _ensure_wgsl_glyphs()

def _resolve_glyph(key: str) -> str:
    resolved = _GLYPH_MAP.get(key)
    if resolved is None:
        raise KeyError(f"Unknown glyph/opcode/name: {key!r}. "
                       f"Known: {sorted(_GLYPH_MAP)}")
    return resolved

# ── Phase engine ──────────────────────────────────────────────────────────────

class PhaseEngine:
    """
    K'UHUL phase-gated compute engine.

    Parameters
    ----------
    glyph_engine : GlyphBufferEngine or None
        Underlying dispatch engine. Created on first use if None.
    strict : bool
        If True, PhaseGateError is raised on gate violation.
        If False, violation is logged and the call is skipped (returns None).
    log : bool
        If True, write JSONL events to .asx_memory.events.jsonl.
    """

    def __init__(self, glyph_engine=None, strict: bool = True, log: bool = True):
        self._engine   = glyph_engine   # lazily created
        self._strict   = strict
        self._log      = log
        self._phase    = Phase.POP
        self._xcfe     = XCFEPlane(strict=strict)   # algebraic control plane
        self._registry: dict[str, np.ndarray] = {}   # Wo allocations
        self._commits:  dict[str, Any]        = {}   # Ch'en outputs
        self._trace:    list[dict]            = []
        self._cycle_ts  = time.time()

    # ── Lazy engine ──────────────────────────────────────────────────────────
    def _get_engine(self):
        if self._engine is None:
            from glyph_buffer_engine import GlyphBufferEngine
            self._engine = GlyphBufferEngine()
        _ensure_glyph_map(self._engine)
        return self._engine

    # ── Phase state ──────────────────────────────────────────────────────────
    @property
    def current_phase(self) -> Phase:
        return self._phase

    @property
    def trace(self) -> list[dict]:
        return self._trace

    def _set_phase(self, phase: Phase) -> "PhaseEngine":
        """Transition to the given phase, validated by the XCFE algebraic plane."""
        frm = self._phase
        try:
            ok = self._xcfe.transition(phase)
        except XCFEViolation as e:
            if self._strict:
                raise PhaseGateError(frm, phase, f"advance to {PHASE_NAMES[phase]}") from e
            return self
        if not ok:
            return self
        self._phase = phase
        self._record("phase.transition", {
            "from":  PHASE_NAMES[frm],
            "to":    PHASE_NAMES[phase],
            "loops": self._xcfe.loops,
            "depth": self._xcfe.depth,
        })
        return self

    def _require_phase(self, phase: Phase, action: str) -> bool:
        if self._phase != phase:
            err = PhaseGateError(self._phase, phase, action)
            if self._strict:
                self._record("phase.gate_violation", {
                    "action": action,
                    "required": PHASE_NAMES[phase],
                    "current": PHASE_NAMES[self._phase],
                })
                raise err
            # non-strict: log and return False so caller can skip
            self._record("phase.gate_violation", {
                "action": action,
                "required": PHASE_NAMES[phase],
                "current":  PHASE_NAMES[self._phase],
                "skipped":  True,
            })
            print(f"[phase-gate WARN] {err}")
            return False
        return True

    # ── ASXRAM event logging ─────────────────────────────────────────────────
    def _event_weight(self, op: str, data: dict) -> float:
        """Priority weight used by memory consumers to rank event importance."""
        if op == "phase.gate_violation":
            return 1.00
        if op == "terminate":
            return 0.95
        if op == "commit":
            return 0.92
        if op == "execute":
            opcode = str(data.get("opcode", ""))
            if opcode.startswith("gpu:") or opcode.startswith("scxq2:"):
                return 0.95
            if opcode == _MATMUL_OPCODE:
                return 0.90
            return 0.82
        if op == "alloc":
            return 0.62
        if op == "phase.transition":
            return 0.58
        if op == "observe":
            return 0.45
        return 0.50

    def _record(self, op: str, data: dict) -> None:
        payload = dict(data)
        explicit_weight = payload.pop("weight", None)
        if isinstance(explicit_weight, (int, float)):
            weight = float(explicit_weight)
        else:
            weight = self._event_weight(op, payload)

        event = {
            "op": op,
            "ts": round(time.time(), 4),
            "phase": PHASE_NAMES.get(self._phase, "?"),
            "weight": round(weight, 3),
            **payload,
        }
        self._trace.append(event)
        if self._log and _ASXRAM_LOG.exists():
            with _ASXRAM_LOG.open("a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")

    # ── Explicit phase advances ───────────────────────────────────────────────
    def pop(self) -> "PhaseEngine":
        """Reset to Pop phase (starts a new cycle). Resets XCFE plane."""
        self._phase    = Phase.POP
        self._xcfe.reset()
        self._registry = {}
        self._commits  = {}
        self._trace    = []
        self._cycle_ts = time.time()
        self._record("observe", {"action": "cycle_start"})
        return self

    def wo(self) -> "PhaseEngine":
        return self._set_phase(Phase.WO)

    def sek(self) -> "PhaseEngine":
        return self._set_phase(Phase.SEK)

    def chen(self) -> "PhaseEngine":
        return self._set_phase(Phase.CHEN)

    def iterate(self) -> "PhaseEngine":
        """
        Ch'en -> Wo back-transition (XCFE training loop).
        Clears the buffer registry for the next iteration while keeping
        committed outputs from the previous Ch'en phase.
        If max_ticks > 0 and tick >= max_ticks, transitions to Xul instead.
        """
        if self._max_ticks > 0 and self._tick >= self._max_ticks:
            self._tick += 1
            return self.xul()
        self._set_phase(Phase.WO)
        self._registry = {}
        self._tick += 1
        return self

    def xul(self) -> dict:
        """Terminate the cycle. Returns committed outputs."""
        self._set_phase(Phase.XUL)
        elapsed = round(time.time() - self._cycle_ts, 4)
        self._record("terminate", {
            "tick":          self._tick,
            "max_ticks":     self._max_ticks,
            "cycle_elapsed_s": elapsed,
            "registry_keys": list(self._registry),
            "commit_keys":   list(self._commits),
            "trace_events":  len(self._trace),
        })
        return dict(self._commits)

    # ── Pop: observe ─────────────────────────────────────────────────────────
    def observe(self, name: str, value: Any) -> "PhaseEngine":
        """Pop phase: snapshot a named value into the trace."""
        if not self._require_phase(Phase.POP, f"observe({name!r})"):
            return self
        summary = value.shape if isinstance(value, np.ndarray) else repr(value)[:80]
        self._record("observe", {"name": name, "value": str(summary)})
        return self

    # ── Wo: alloc ────────────────────────────────────────────────────────────
    def alloc(self, name: str, data: np.ndarray) -> "PhaseEngine":
        """Wo phase: register a named float32 buffer."""
        if not self._require_phase(Phase.WO, f"alloc({name!r})"):
            return self
        arr = np.asarray(data, dtype=np.float32)
        self._registry[name] = arr
        self._record("alloc", {"name": name, "shape": list(arr.shape),
                               "dtype": "f32"})
        return self

    def _buf(self, ref) -> np.ndarray:
        """Resolve a name or array to a numpy float32 array."""
        if isinstance(ref, str):
            if ref in self._registry:
                return self._registry[ref]
            if ref in self._commits:
                return np.asarray(self._commits[ref], dtype=np.float32)
            raise KeyError(f"No buffer named {ref!r}. "
                           f"Registry: {list(self._registry)}. "
                           f"Commits: {list(self._commits)}")
        return np.asarray(ref, dtype=np.float32)

    # ── Sek: dispatch elementwise lane ───────────────────────────────────────
    def dispatch(self, glyph: str, a, b=None) -> np.ndarray:
        """
        Sek phase: dispatch a compute lane by glyph name.

        Routes to the appropriate backend automatically:
          CPU DLL lanes:   "+", "-", "*", "/", "silu", "gelu", ...
          GPU WGSL lanes:  "swiglu", "geglu", "geglu_erf", "rms_norm", "softmax"

        Use .matmul() for matrix multiply.
        Use .execute_pi_field() / .execute_wave() for structured GPU ops.
        """
        if not self._require_phase(Phase.SEK, f"dispatch({glyph!r})"):
            return np.array([], dtype=np.float32)

        # Ensure WGSL glyphs are registered (lazy; doesn't touch DLL)
        _ensure_wgsl_glyphs()
        _ensure_scxq2_glyphs()

        # Try WGSL GPU ops first (don't need the DLL)
        wgsl_op = _GLYPH_MAP.get(glyph)
        if wgsl_op and wgsl_op in _WGSL_GPU_OPS:
            a_arr = self._buf(a)
            b_arr = self._buf(b) if b is not None else None
            t0     = time.perf_counter()
            result = _WGSL_GPU_OPS[wgsl_op](a_arr, b_arr)
            ms     = round((time.perf_counter() - t0) * 1000, 3)
            self._record("execute", {"glyph": glyph, "opcode": wgsl_op,
                                     "backend": "gpu_wgsl",
                                     "shape": list(result.shape), "ms": ms})
            return result

        # Fall through to CPU DLL lanes
        eng = self._get_engine()
        op  = _resolve_glyph(glyph)
        if op == _MATMUL_OPCODE:
            raise ValueError("Use .matmul() for WO_MATMUL, not .dispatch()")
        if op.startswith("gpu:"):
            raise ValueError(
                f"GPU op {op!r} requires a structured call — "
                f"use .execute_pi_field() or .execute_wave()"
            )
        if op not in _ELEMENTWISE_OPCODES:
            raise ValueError(f"Unknown dispatch target: {glyph!r} -> {op!r}")

        a_arr  = self._buf(a)
        b_arr  = self._buf(b) if b is not None else None
        op_int = int(op, 16)
        t0     = time.perf_counter()
        result = eng.execute_glyph(op_int, a_arr, b_arr)
        ms     = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": glyph, "opcode": op,
                                 "backend": "cpu_dll",
                                 "shape": list(result.shape), "ms": ms})
        return result

    # ── Sek: matmul ──────────────────────────────────────────────────────────
    def matmul(self, a, b) -> np.ndarray:
        """Sek phase: WO_MATMUL — row-major float32 matrix multiply."""
        if not self._require_phase(Phase.SEK, "matmul"):
            return np.array([], dtype=np.float32)
        eng   = self._get_engine()
        a_arr = self._buf(a)
        b_arr = self._buf(b)
        t0    = time.perf_counter()
        result = eng.execute_matmul(a_arr, b_arr)
        ms     = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "WO_MATMUL", "opcode": _MATMUL_OPCODE,
                                 "shape": list(result.shape), "ms": ms})
        return result

    # ── Sek: GPU pi-field ────────────────────────────────────────────────────
    def execute_pi_field(
        self,
        nodes:     np.ndarray,
        node_meta: np.ndarray,
        edges:     np.ndarray,
        field:     np.ndarray,
        sources:   np.ndarray,
        params:    dict,
        steps:     int = 1,
    ) -> np.ndarray:
        """Sek phase: GPU π-field diffusion via pi_field_shader.wgsl."""
        if not self._require_phase(Phase.SEK, "execute_pi_field"):
            return field
        eng = self._get_engine()
        t0  = time.perf_counter()
        result = eng.execute_pi_field(nodes, node_meta, edges, field, sources, params, steps)
        ms     = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "pi_field", "opcode": "gpu:pi_field",
                                 "nodes": nodes.shape[0], "steps": steps, "ms": ms})
        return result

    # ── Sek: GPU SH wave ─────────────────────────────────────────────────────
    def execute_wave(
        self,
        sh_coeffs: np.ndarray,
        dt:        float,
        steps:     int = 1,
    ) -> np.ndarray:
        """Sek phase: GPU SH wave propagation via optical_wave.wgsl (ping-pong)."""
        if not self._require_phase(Phase.SEK, "execute_wave"):
            return sh_coeffs
        from wgpu_optical_wave import run_optical_wave
        t0     = time.perf_counter()
        result = run_optical_wave(sh_coeffs, dt, steps=steps)
        ms     = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "wave", "opcode": "gpu:wave",
                                 "nodes": sh_coeffs.shape[0], "dt": dt,
                                 "steps": steps, "ms": ms})
        return result

    # ── Sek: GPU WGSL lanes (ggml shaders) ──────────────────────────────────

    def execute_swiglu(self, a, b) -> np.ndarray:
        """Sek: SwiGLU — out[i] = a[i]*sigmoid(a[i])*b[i] on GPU via glu.wgsl."""
        if not self._require_phase(Phase.SEK, "execute_swiglu"):
            return np.array([], dtype=np.float32)
        from ggml_wgsl_lanes import swiglu
        a_arr = self._buf(a)
        b_arr = self._buf(b)
        t0     = time.perf_counter()
        result = swiglu(a_arr, b_arr)
        ms     = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "WO_SWIGLU", "opcode": "gpu:swiglu",
                                 "shape": list(result.shape), "ms": ms})
        return result

    def execute_geglu(self, a, b, variant: str = "geglu") -> np.ndarray:
        """Sek: GeGLU/GeGLU_ERF — out[i] = GELU(a[i])*b[i] on GPU via glu.wgsl."""
        if not self._require_phase(Phase.SEK, f"execute_{variant}"):
            return np.array([], dtype=np.float32)
        import ggml_wgsl_lanes as _gl
        fn = {"geglu": _gl.geglu, "geglu_erf": _gl.geglu_erf}.get(variant, _gl.geglu)
        a_arr = self._buf(a)
        b_arr = self._buf(b)
        t0     = time.perf_counter()
        result = fn(a_arr, b_arr)
        ms     = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": f"WO_{variant.upper()}", "opcode": f"gpu:{variant}",
                                 "shape": list(result.shape), "ms": ms})
        return result

    def execute_rms_norm(self, src, eps: float = 1e-5) -> np.ndarray:
        """Sek: RMS normalize each row of src on GPU via row_norm.wgsl."""
        if not self._require_phase(Phase.SEK, "execute_rms_norm"):
            return np.array([], dtype=np.float32)
        from ggml_wgsl_lanes import rms_norm
        src_arr = self._buf(src)
        t0      = time.perf_counter()
        result  = rms_norm(src_arr, eps)
        ms      = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "WO_RMS_NORM", "opcode": "gpu:rms_norm",
                                 "shape": list(result.shape), "eps": eps, "ms": ms})
        return result

    def execute_softmax(self, src, scale: float = 1.0) -> np.ndarray:
        """Sek: Softmax over last dimension on GPU via soft_max.wgsl."""
        if not self._require_phase(Phase.SEK, "execute_softmax"):
            return np.array([], dtype=np.float32)
        from ggml_wgsl_lanes import softmax
        src_arr = self._buf(src)
        t0      = time.perf_counter()
        result  = softmax(src_arr, scale)
        ms      = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "WO_SOFTMAX", "opcode": "gpu:softmax",
                                 "shape": list(result.shape), "scale": scale, "ms": ms})
        return result

    def execute_silu_back(self, dy, x) -> np.ndarray:
        """Sek: SiLU gradient on GPU (backward pass)."""
        if not self._require_phase(Phase.SEK, "execute_silu_back"):
            return np.array([], dtype=np.float32)
        from ggml_wgsl_lanes_back import silu_back
        dy_arr, x_arr = self._buf(dy), self._buf(x)
        t0 = time.perf_counter()
        result = silu_back(dy_arr, x_arr)
        ms = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "∇silu", "opcode": "gpu:silu_back",
                                 "backend": "gpu_wgsl_back", "shape": list(result.shape), "ms": ms})
        return result

    def execute_softmax_back(self, dy, y) -> np.ndarray:
        """Sek: Softmax Jacobian-vector product on GPU (backward pass)."""
        if not self._require_phase(Phase.SEK, "execute_softmax_back"):
            return np.array([], dtype=np.float32)
        from ggml_wgsl_lanes_back import softmax_back
        dy_arr, y_arr = self._buf(dy), self._buf(y)
        t0 = time.perf_counter()
        result = softmax_back(dy_arr, y_arr)
        ms = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "∇softmax", "opcode": "gpu:softmax_back",
                                 "backend": "gpu_wgsl_back", "shape": list(result.shape), "ms": ms})
        return result

    def execute_rms_norm_back(self, dy, x, eps: float = 1e-5) -> np.ndarray:
        """Sek: RMS norm gradient on GPU (backward pass)."""
        if not self._require_phase(Phase.SEK, "execute_rms_norm_back"):
            return np.array([], dtype=np.float32)
        from ggml_wgsl_lanes_back import rms_norm_back
        dy_arr, x_arr = self._buf(dy), self._buf(x)
        t0 = time.perf_counter()
        result = rms_norm_back(dy_arr, x_arr, eps)
        ms = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "∇rms", "opcode": "gpu:rms_norm_back",
                                 "backend": "gpu_wgsl_back", "shape": list(result.shape), "ms": ms})
        return result

    def execute_cross_entropy_back(self, logits, labels) -> np.ndarray:
        """
        Sek: Cross-entropy loss backward on GPU.
        grad[b,c] = (softmax(logits)[b,c] - one_hot(labels[b],c)) / batch_size
        labels must be integer class indices.
        """
        if not self._require_phase(Phase.SEK, "execute_cross_entropy_back"):
            return np.array([], dtype=np.float32)
        from ggml_wgsl_lanes_back import cross_entropy_back
        l_arr = self._buf(logits)
        lbl   = np.asarray(self._buf(labels) if isinstance(labels, str)
                           else labels, dtype=np.uint32).ravel()
        t0 = time.perf_counter()
        result = cross_entropy_back(l_arr, lbl)
        ms = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "∇xe", "opcode": "gpu:cross_entropy_back",
                                 "backend": "gpu_wgsl_back", "shape": list(result.shape), "ms": ms})
        return result

    def execute_gelu_back(self, dy, x) -> np.ndarray:
        """Sek: GELU gradient on GPU (tanh approx)."""
        if not self._require_phase(Phase.SEK, "execute_gelu_back"):
            return np.array([], dtype=np.float32)
        from ggml_wgsl_lanes_back import gelu_back
        dy_arr, x_arr = self._buf(dy), self._buf(x)
        t0 = time.perf_counter()
        result = gelu_back(dy_arr, x_arr)
        ms = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "∇gelu", "opcode": "gpu:gelu_back",
                                 "backend": "gpu_wgsl_back", "shape": list(result.shape), "ms": ms})
        return result

    def execute_sgd_step(
        self, param, grad, velocity,
        lr: float = 1e-2, momentum: float = 0.9, wd: float = 0.0,
    ) -> tuple:
        """Sek: SGD + momentum GPU step. Returns (updated_param, updated_velocity)."""
        if not self._require_phase(Phase.SEK, "execute_sgd_step"):
            z = np.array([], dtype=np.float32)
            return z, z
        from ggml_wgsl_lanes_back import sgd_step
        p_arr = self._buf(param)
        g_arr = self._buf(grad)
        v_arr = self._buf(velocity)
        t0 = time.perf_counter()
        p2, v2 = sgd_step(p_arr, g_arr, v_arr, lr, momentum, wd)
        ms = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "∇sgd", "opcode": "gpu:sgd_step",
                                 "backend": "gpu_wgsl_back", "ms": ms})
        return p2, v2

    def execute_adam_step(
        self, param, grad, m, v,
        step: int,
        lr: float = 1e-3,
        b1: float = 0.9,
        b2: float = 0.999,
        eps: float = 1e-8,
        wd:  float = 0.0,
    ) -> tuple:
        """
        Sek: AdamW GPU parameter update.
        Returns (updated_param, updated_m, updated_v) as numpy arrays.
        """
        if not self._require_phase(Phase.SEK, "execute_adam_step"):
            z = np.array([], dtype=np.float32)
            return z, z, z
        from ggml_wgsl_lanes_back import adam_step
        p_arr = self._buf(param)
        g_arr = self._buf(grad)
        m_arr = self._buf(m)
        v_arr = self._buf(v)
        t0 = time.perf_counter()
        p2, m2, v2 = adam_step(p_arr, g_arr, m_arr, v_arr, step, lr, b1, b2, eps, wd)
        ms = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {"glyph": "∇adam", "opcode": "gpu:adam_step",
                                 "backend": "gpu_wgsl_back", "step": step, "ms": ms})
        return p2, m2, v2

    # ── SCXQ2 graph executor ──────────────────────────────────────────────────

    def execute_scxq2_graph(
        self,
        ir: "dict | str",
        inputs: "dict[int, np.ndarray] | None" = None,
    ) -> "dict[int, np.ndarray]":
        """
        Sek: Execute a SCXQ2 IR graph on the GPU (pure WGSL path — no D3D11).

        Parameters
        ----------
        ir : dict or JSON string
            SCXQ2 IR with "nodes" and "tensors" keys.
        inputs : dict[int, ndarray] or None
            Named input tensors by tensor id. When a tensor id matches a key
            in the Wo-phase buffer registry, the registry value is used and
            inputs overrides it if also present.

        Returns
        -------
        dict[int, ndarray] — all tensor values after graph execution.

        Supported opcodes: MATMUL, ADD, SUB, MUL, DIV, RELU, SILU, GELU,
                           SOFTMAX, RMS_NORM.
        """
        if not self._require_phase(Phase.SEK, "execute_scxq2_graph"):
            return {}
        import scxq2_wgsl_backend as _sq
        import json as _json

        if isinstance(ir, str):
            ir_dict = _json.loads(ir)
        else:
            ir_dict = ir

        # Merge Wo registry into inputs (registry values are defaults)
        merged: dict[int, np.ndarray] = {}
        if inputs:
            merged.update(inputs)

        t0 = time.perf_counter()
        result = _sq.execute_ir(ir_dict, merged)
        ms = round((time.perf_counter() - t0) * 1000, 3)

        nodes = ir_dict.get("nodes", [])
        opcodes = [n.get("opcode") for n in nodes]
        self._record("execute", {
            "glyph": "scxq2_graph", "opcode": "scxq2:graph",
            "backend": "scxq2_wgsl", "nodes": len(nodes),
            "opcodes": opcodes, "ms": ms,
        })
        return result

    def execute_scxq2_klsl(self, klsl_source: str, arrays: "list[np.ndarray]",
                           out_shape: tuple, dispatch_xyz: tuple = (1, 1, 1)) -> np.ndarray:
        """
        Sek: Compile a KLSL shader to WGSL on-the-fly and dispatch it.

        This is the KLSL→WGSL path that bypasses D3D11 entirely.

        Parameters
        ----------
        klsl_source  : KLSL shader source string (⟁ shader ... ⟁Xul⟁ block)
        arrays       : list of float32 numpy input arrays, matched to @binding 0..N-1
        out_shape    : expected output shape (last array is the output)
        dispatch_xyz : (x, y, z) workgroup dispatch counts
        """
        if not self._require_phase(Phase.SEK, "execute_scxq2_klsl"):
            return np.array([], dtype=np.float32)
        from klsl_wgsl_emitter import emit_wgsl
        import scxq2_wgsl_backend as _sq
        import struct

        wgsl = emit_wgsl(klsl_source)
        n = int(np.prod(out_shape))
        params_bytes = struct.pack("I", n) + b"\x00" * 12

        t0 = time.perf_counter()
        result = _sq._run_op(
            "klsl:" + klsl_source[:32],
            wgsl,
            [a.astype(np.float32) for a in arrays],
            params_bytes,
            out_idx=len(arrays) - 1,
            dx=dispatch_xyz[0], dy=dispatch_xyz[1], dz=dispatch_xyz[2],
        )
        ms = round((time.perf_counter() - t0) * 1000, 3)
        self._record("execute", {
            "glyph": "klsl_wgsl", "opcode": "scxq2:klsl",
            "backend": "klsl_wgsl", "shape": list(out_shape), "ms": ms,
        })
        return result.reshape(out_shape)

    # ── Ch'en: commit ─────────────────────────────────────────────────────────
    def commit(self, name: str, value: Any) -> "PhaseEngine":
        """Ch'en phase: store a named result for return by .xul()."""
        if not self._require_phase(Phase.CHEN, f"commit({name!r})"):
            return self
        self._commits[name] = value
        shape = value.shape if isinstance(value, np.ndarray) else None
        self._record("commit", {"name": name, "shape": list(shape) if shape else None})
        return self

    # ── Stats ────────────────────────────────────────────────────────────────
    def stats(self) -> dict:
        execute_events = [e for e in self._trace if e["op"] == "execute"]
        return {
            "current_phase":   PHASE_NAMES.get(self._phase, "?"),
            "trace_events":    len(self._trace),
            "executions":      len(execute_events),
            "total_exec_ms":   round(sum(e.get("ms", 0) for e in execute_events), 3),
            "registry_keys":   list(self._registry),
            "commit_keys":     list(self._commits),
        }

    def __repr__(self) -> str:
        return (f"PhaseEngine(phase={PHASE_NAMES[self._phase]}, "
                f"registry={list(self._registry)}, "
                f"commits={list(self._commits)})")


# ── CLI demo ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    print("=" * 60)
    print("K'UHUL Phase Engine Demo")
    print("=" * 60)

    rng = np.random.default_rng(7)
    eng = PhaseEngine(strict=True, log=True)

    # ── 1. Gate violation: dispatch during Pop ───────────────────────────────
    print("\n[1] Gate violation test — dispatch('+') during Pop phase")
    try:
        eng.pop()
        eng.dispatch("+", np.array([1.0, 2.0]), np.array([10.0, 20.0]))
        print("  ERROR: should have raised PhaseGateError")
        sys.exit(1)
    except PhaseGateError as e:
        print(f"  PhaseGateError (expected): {e}")

    # ── 2. Full cycle: Pop -> Wo -> Sek -> Ch'en -> Xul ──────────────────────
    print("\n[2] Full Pop -> Wo -> Sek -> Ch'en -> Xul cycle")

    eng.pop()
    print(f"  phase: {PHASE_NAMES[eng.current_phase]}")
    eng.observe("input_shape", np.zeros((512, 9)))

    eng.wo()
    print(f"  phase: {PHASE_NAMES[eng.current_phase]}")
    a = rng.standard_normal(8).astype(np.float32)
    b = rng.standard_normal(8).astype(np.float32)
    eng.alloc("a", a)
    eng.alloc("b", b)
    eng.alloc("lhs", np.array([[1,2,3],[4,5,6]], dtype=np.float32))
    eng.alloc("rhs", np.array([[7,8],[9,10],[11,12]], dtype=np.float32))

    eng.sek()
    print(f"  phase: {PHASE_NAMES[eng.current_phase]}")

    # CPU elementwise lane: WO_ADD
    add_result = eng.dispatch("+", "a", "b")
    print(f"  WO_ADD  a+b  = {add_result.tolist()}")

    # CPU elementwise lane: WO_SILU (arity=1)
    silu_result = eng.dispatch("silu", "a")
    print(f"  WO_SILU silu = {[round(x,4) for x in silu_result.tolist()]}")

    # CPU tensor lane: WO_MATMUL (must use .matmul(), not .dispatch())
    mat_result = eng.matmul("lhs", "rhs")
    print(f"  WO_MATMUL    =\n{mat_result}")

    # GPU SH wave lane
    sh = rng.standard_normal((256, 9)).astype(np.float32)
    wave_result = eng.execute_wave(sh, dt=0.05, steps=10)
    norms = np.linalg.norm(wave_result, axis=1)
    print(f"  wave (256 nodes, 10 steps)  mean L2 norm = {norms.mean():.6f}")

    eng.chen()
    print(f"  phase: {PHASE_NAMES[eng.current_phase]}")
    eng.commit("add_result",  add_result)
    eng.commit("mat_result",  mat_result)
    eng.commit("wave_result", wave_result)

    outputs = eng.xul()
    print(f"  phase: {PHASE_NAMES[eng.current_phase]}")
    print(f"  committed keys: {list(outputs)}")

    # ── 3. GPU WGSL lanes via dispatch() ─────────────────────────────────────
    print("\n[3] GPU WGSL lanes via dispatch() — same gated call surface as CPU")

    eng2 = PhaseEngine(strict=True, log=True)
    eng2.pop()
    eng2.observe("wgsl_test", "ggml shader suite")

    eng2.wo()
    N = 512
    ga = rng.standard_normal(N).astype(np.float32)
    gb = rng.standard_normal(N).astype(np.float32)
    eng2.alloc("ga", ga)
    eng2.alloc("gb", gb)
    eng2.alloc("hidden", rng.standard_normal((8, 64)).astype(np.float32))

    eng2.sek()

    # SwiGLU via dispatch()
    swiglu_out = eng2.dispatch("swiglu", "ga", "gb")
    ref_swiglu = ga / (1.0 + np.exp(-ga)) * gb
    err = float(np.max(np.abs(swiglu_out - ref_swiglu)))
    print(f"  dispatch('swiglu', ga, gb)  -> shape={swiglu_out.shape}  max_err={err:.2e}")

    # RMS_NORM via dispatch() (b=None, operates on 2D hidden)
    rms_out = eng2.dispatch("rms_norm", "hidden")
    rms = np.sqrt(np.mean(eng2._registry["hidden"]**2, axis=1, keepdims=True))
    ref_rms = eng2._registry["hidden"] / (rms + 1e-5)
    err = float(np.max(np.abs(rms_out - ref_rms)))
    print(f"  dispatch('rms_norm', hidden) -> shape={rms_out.shape}  max_err={err:.2e}")

    # Softmax via dispatch()
    softmax_out = eng2.dispatch("softmax", "hidden")
    row_sum_err = float(np.max(np.abs(softmax_out.sum(axis=1) - 1.0)))
    print(f"  dispatch('softmax', hidden)  -> shape={softmax_out.shape}  row_sum_err={row_sum_err:.2e}")

    # GeGLU via dispatch()
    geglu_out = eng2.dispatch("geglu", "ga", "gb")
    print(f"  dispatch('geglu', ga, gb)   -> shape={geglu_out.shape}  [{geglu_out[:3].tolist()}]")

    eng2.chen()
    eng2.commit("swiglu", swiglu_out)
    eng2.commit("rms_norm", rms_out)
    eng2.commit("softmax", softmax_out)
    outputs2 = eng2.xul()
    print(f"  committed: {list(outputs2)}")

    # ── 4. Stats ─────────────────────────────────────────────────────────────
    print("\n[4] Cycle stats (first cycle)")
    s = eng.stats()
    for k, v in s.items():
        print(f"  {k}: {v}")

    # ── 5. Gate violation: alloc during Xul ──────────────────────────────────
    print("\n[5] Gate violation test — alloc() after Xul (wrong phase)")
    try:
        eng.alloc("late", np.zeros(4, np.float32))
        print("  ERROR: should have raised PhaseGateError")
        sys.exit(1)
    except PhaseGateError as e:
        print(f"  PhaseGateError (expected): {e}")

    # ── 6. Trace: GPU WGSL backends visible in events ────────────────────────
    print("\n[6] WGSL GPU events in trace (backend field)")
    wgsl_events = [e for e in eng2.trace if e.get("backend") == "gpu_wgsl"]
    for ev in wgsl_events:
        print(f"  op={ev['op']}  glyph={ev['glyph']}  opcode={ev['opcode']}  ms={ev.get('ms')}")

    print("\nPhase engine OK.")
