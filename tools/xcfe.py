"""
xcfe.py — K'UHUL XCFE Algebraic Control Plane.

Defines the legal phase transition algebra for the K'UHUL runtime.
XCFE = eXtended Control Flow Engine.

The six K'UHUL phases and their opcodes:

    Pop   0x80 — PERCEIVE   — initialize, allocate context, observe
    Wo    0x81 — WRITE      — load data, buffers, tensors
    Yax   0x84 — READ       — conditional read / branch select
    Sek   0x82 — EXECUTE    — compute kernels, dispatch lanes
    Ch'en 0x88 — COMMIT     — store results, emit outputs
    Xul   0x83 — TERMINATE  — collapse, release, stabilize

XCFE legal transition graph (superset of the strict linear order):

    Pop   → [Wo]                    standard entry
    Wo    → [Sek, Ch'en]            Wo→Ch'en: data staging without compute
    Yax   → [Sek]                   branch selection resolves to execution
    Sek   → [Ch'en, Xul]            Sek→Xul: short-circuit (no commit needed)
    Ch'en → [Xul, Wo]               Ch'en→Wo: TRAINING LOOP (iterate back)
    Xul   → []                      terminal — no further transitions

Explicit illegal transitions:

    Pop   → [Xul, Sek, Ch'en, Yax]  can't skip straight to compute
    Yax   → [Pop, Wo, Ch'en, Xul]   branches must resolve through Sek
    Sek   → [Pop, Wo, Yax]          can't un-execute
    Ch'en → [Pop, Sek, Yax]         can't recompute without allocating
    Xul   → [anything]              terminal is terminal

Fold allowances (governance for nested / parallel execution):

    ALLOW:    nested_phases, parallel_lanes, tensor_ops
    DISALLOW: cross_phase_jumps, unbalanced_phase_pairs

The key unlock versus strict linear order:
    Ch'en → Wo  enables training loops without rebuilding the engine.
    Wo    → Ch'en enables pure data-staging folds (load → commit, no compute).
"""

from __future__ import annotations
from enum import IntEnum
from typing import Sequence


# ---------------------------------------------------------------------------
# Phase constants
# ---------------------------------------------------------------------------

class Phase(IntEnum):
    POP  = 0x80   # Perceive / initialize
    WO   = 0x81   # Write / allocate
    YAX  = 0x84   # Read / branch
    SEK  = 0x82   # Execute / compute
    CHEN = 0x88   # Commit / store
    XUL  = 0x83   # Terminate / collapse


PHASE_NAMES: dict[int, str] = {
    Phase.POP:  "Pop",
    Phase.WO:   "Wo",
    Phase.YAX:  "Yax",
    Phase.SEK:  "Sek",
    Phase.CHEN: "Ch'en",
    Phase.XUL:  "Xul",
}

# Canonical execution order (not hex order — 0x88 > 0x83 but Ch'en precedes Xul)
PHASE_ORDER: list[Phase] = [Phase.POP, Phase.WO, Phase.YAX, Phase.SEK, Phase.CHEN, Phase.XUL]


# ---------------------------------------------------------------------------
# XCFE transition graph
# ---------------------------------------------------------------------------

# Legal "next phase" sets for each phase
LEGAL_TRANSITIONS: dict[Phase, frozenset[Phase]] = {
    Phase.POP:  frozenset([Phase.WO]),
    Phase.WO:   frozenset([Phase.SEK, Phase.CHEN]),
    Phase.YAX:  frozenset([Phase.SEK]),
    Phase.SEK:  frozenset([Phase.CHEN, Phase.XUL]),
    Phase.CHEN: frozenset([Phase.XUL, Phase.WO]),   # Wo = iterate/train loop
    Phase.XUL:  frozenset(),
}

# Explicit illegal sets (for diagnostic messages)
ILLEGAL_TRANSITIONS: dict[Phase, frozenset[Phase]] = {
    Phase.POP:  frozenset([Phase.XUL, Phase.SEK, Phase.CHEN, Phase.YAX]),
    Phase.YAX:  frozenset([Phase.POP, Phase.WO, Phase.CHEN, Phase.XUL]),
    Phase.SEK:  frozenset([Phase.POP, Phase.WO, Phase.YAX]),
    Phase.CHEN: frozenset([Phase.POP, Phase.SEK, Phase.YAX]),
    Phase.XUL:  frozenset([Phase.POP, Phase.WO, Phase.YAX, Phase.SEK, Phase.CHEN]),
}

# Fold governance
FOLD_ALLOW    = frozenset(["nested_phases", "parallel_lanes", "tensor_ops"])
FOLD_DISALLOW = frozenset(["cross_phase_jumps", "unbalanced_phase_pairs"])


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------

class XCFEViolation(Exception):
    """Raised when a phase transition violates XCFE algebraic rules."""


# ---------------------------------------------------------------------------
# XCFE control plane
# ---------------------------------------------------------------------------

class XCFEPlane:
    """
    XCFE algebraic control plane instance.

    Tracks current phase, validates transitions, counts training loops,
    and manages nested fold depth.

    Usage::

        xcfe = XCFEPlane(strict=True)
        xcfe.transition(Phase.WO)     # Pop → Wo ✅
        xcfe.transition(Phase.SEK)    # Wo  → Sek ✅
        xcfe.transition(Phase.CHEN)   # Sek → Ch'en ✅
        xcfe.transition(Phase.WO)     # Ch'en → Wo ✅ (training loop!)
        xcfe.loops                    # → 1
    """

    def __init__(self, strict: bool = True):
        self._phase   = Phase.POP
        self._strict  = strict
        self._depth   = 0
        self._history: list[Phase] = [Phase.POP]
        self._loops   = 0
        self._folds:  list[str] = []   # active fold tags

    # ── properties ───────────────────────────────────────────────────────────

    @property
    def phase(self) -> Phase:
        return self._phase

    @property
    def depth(self) -> int:
        """Current nested fold depth."""
        return self._depth

    @property
    def loops(self) -> int:
        """Number of Ch'en→Wo back-transitions (training iterations)."""
        return self._loops

    @property
    def history(self) -> list[Phase]:
        return list(self._history)

    # ── transition ───────────────────────────────────────────────────────────

    def transition(self, to: Phase) -> bool:
        """
        Attempt a phase transition. Returns True if legal.
        Raises XCFEViolation (strict=True) or returns False (strict=False)
        on an illegal move.
        """
        legal = LEGAL_TRANSITIONS.get(self._phase, frozenset())
        if to in legal:
            if self._phase == Phase.CHEN and to == Phase.WO:
                self._loops += 1
            self._phase = to
            self._history.append(to)
            return True

        msg = (
            f"XCFE violation: {PHASE_NAMES[self._phase]} -> {PHASE_NAMES[to]} "
            f"is not a legal transition. "
            f"Legal from {PHASE_NAMES[self._phase]}: "
            f"{sorted(PHASE_NAMES[p] for p in legal) or ['(none - terminal)']}"
        )
        if self._strict:
            raise XCFEViolation(msg)
        return False

    def can_transition(self, to: Phase) -> bool:
        """Non-mutating check whether a transition would be legal."""
        return to in LEGAL_TRANSITIONS.get(self._phase, frozenset())

    # ── fold control ─────────────────────────────────────────────────────────

    def enter_fold(self, tag: str = "") -> "XCFEPlane":
        """Enter a nested fold context."""
        self._depth += 1
        self._folds.append(tag)
        return self

    def exit_fold(self) -> str:
        """Exit the innermost fold context. Returns its tag."""
        if self._depth == 0:
            raise XCFEViolation("Cannot exit fold: not in a nested fold")
        self._depth -= 1
        return self._folds.pop()

    # ── lifecycle ────────────────────────────────────────────────────────────

    def reset(self) -> "XCFEPlane":
        """Reset to Pop for a new cycle (does not increment loops)."""
        self._phase = Phase.POP
        self._history.append(Phase.POP)
        self._depth = 0
        self._folds.clear()
        return self

    # ── introspection ────────────────────────────────────────────────────────

    def legal_next(self) -> list[Phase]:
        """Return the list of phases legally reachable from the current phase."""
        return sorted(LEGAL_TRANSITIONS.get(self._phase, frozenset()),
                      key=PHASE_ORDER.index)

    def state(self) -> dict:
        return {
            "phase":      PHASE_NAMES[self._phase],
            "depth":      self._depth,
            "loops":      self._loops,
            "history":    [PHASE_NAMES[p] for p in self._history[-8:]],
            "legal_next": [PHASE_NAMES[p] for p in self.legal_next()],
            "folds":      list(self._folds),
        }

    def __repr__(self) -> str:
        return (f"XCFEPlane(phase={PHASE_NAMES[self._phase]}, "
                f"loops={self._loops}, depth={self._depth})")


# ---------------------------------------------------------------------------
# Capability registry — what the runtime can do at each phase
# ---------------------------------------------------------------------------

PHASE_CAPABILITIES: dict[Phase, dict] = {
    Phase.POP: {
        "ops":       ["observe", "context_init", "fold_open"],
        "parallel":  False,
        "pipeline":  True,
        "backends":  [],
    },
    Phase.WO: {
        "ops":       ["alloc", "load_tensor", "register_buffer", "set_weight"],
        "parallel":  True,
        "pipeline":  True,
        "backends":  ["cpu", "gpu_wgsl"],
    },
    Phase.YAX: {
        "ops":       ["read", "branch", "select", "moe_route"],
        "parallel":  True,
        "pipeline":  True,
        "backends":  ["cpu"],
    },
    Phase.SEK: {
        "ops": [
            # CPU DLL lanes
            "add", "sub", "mul", "div", "silu", "gelu", "matmul",
            # GPU forward
            "swiglu", "geglu", "geglu_erf", "rms_norm", "softmax",
            # GPU backward
            "silu_back", "softmax_back", "rms_norm_back",
            "cross_entropy_back", "gelu_back",
            # Optimizers
            "adam_step", "sgd_step",
            # Structured GPU
            "pi_field", "wave",
        ],
        "parallel":  True,
        "pipeline":  True,
        "backends":  ["cpu_dll", "gpu_wgsl", "gpu_wgsl_back", "gpu_pi"],
    },
    Phase.CHEN: {
        "ops":       ["commit", "emit", "persist", "fold_close"],
        "parallel":  True,
        "pipeline":  True,
        "backends":  ["cpu"],
    },
    Phase.XUL: {
        "ops":       ["terminate", "flush_trace", "release_buffers"],
        "parallel":  False,
        "pipeline":  False,
        "backends":  [],
    },
}


# ---------------------------------------------------------------------------
# Opcode → phase affinity (which phase each opcode executes in)
# ---------------------------------------------------------------------------

OPCODE_PHASE: dict[str, Phase] = {
    # Wo-phase ops
    "WO_SET":    Phase.WO,
    "WO_COPY":   Phase.WO,
    # Sek-phase CPU ops
    "WO_ADD":    Phase.SEK,
    "WO_SUB":    Phase.SEK,
    "WO_MUL":    Phase.SEK,
    "WO_DIV":    Phase.SEK,
    "WO_SILU":   Phase.SEK,
    "WO_GELU":   Phase.SEK,
    "WO_MATMUL": Phase.SEK,
    # Sek-phase GPU forward
    "WO_SWIGLU":    Phase.SEK,
    "WO_GEGLU":     Phase.SEK,
    "WO_GEGLU_ERF": Phase.SEK,
    "WO_RMS_NORM":  Phase.SEK,
    "WO_SOFTMAX":   Phase.SEK,
    # Sek-phase GPU backward
    "WO_SILU_BACK":     Phase.SEK,
    "WO_SOFTMAX_BACK":  Phase.SEK,
    "WO_RMS_NORM_BACK": Phase.SEK,
    "WO_XE_BACK":       Phase.SEK,
    "WO_GELU_BACK":     Phase.SEK,
    "WO_ADAM_STEP":     Phase.SEK,
    "WO_SGD_STEP":      Phase.SEK,
    # Ch'en ops
    "RENDER_EMIT":   Phase.CHEN,
}


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def validate_sequence(phases: Sequence[Phase], strict: bool = True) -> list[str]:
    """
    Validate a complete phase sequence against XCFE rules.
    Returns a list of violation strings (empty = valid).
    """
    errors: list[str] = []
    for i in range(1, len(phases)):
        frm, to = phases[i - 1], phases[i]
        if to not in LEGAL_TRANSITIONS.get(frm, frozenset()):
            msg = (f"Step {i}: {PHASE_NAMES[frm]} -> {PHASE_NAMES[to]} is illegal")
            errors.append(msg)
            if strict:
                break
    return errors


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("XCFE Algebraic Control Plane — self-test")
    print("=" * 48)

    xcfe = XCFEPlane(strict=True)
    print(f"initial: {xcfe}")

    # Standard cycle
    for to in [Phase.WO, Phase.SEK, Phase.CHEN, Phase.XUL]:
        xcfe.transition(to)
        print(f"  -> {PHASE_NAMES[to]}  {xcfe}")

    # Training loop: reset and do Ch'en→Wo back-transitions
    xcfe.reset()
    xcfe.transition(Phase.WO)
    xcfe.transition(Phase.SEK)
    xcfe.transition(Phase.CHEN)
    for i in range(3):
        xcfe.transition(Phase.WO)   # ← Ch'en→Wo loop
        xcfe.transition(Phase.SEK)
        xcfe.transition(Phase.CHEN)
    xcfe.transition(Phase.XUL)
    print(f"\nTraining loop completed. loops={xcfe.loops}  (expected 3)")
    assert xcfe.loops == 3

    # Illegal transition
    xcfe2 = XCFEPlane(strict=False)
    ok = xcfe2.transition(Phase.SEK)   # Pop → Sek: illegal
    print(f"\nPop->Sek (strict=False): returned {ok}  (expected False)")
    assert not ok

    # Sequence validator
    seq = [Phase.POP, Phase.WO, Phase.SEK, Phase.CHEN, Phase.WO, Phase.SEK, Phase.CHEN, Phase.XUL]
    errs = validate_sequence(seq)
    print(f"\nSequence with training loop — violations: {errs}  (expected [])")
    assert errs == []

    bad_seq = [Phase.POP, Phase.SEK]   # illegal skip
    errs2 = validate_sequence(bad_seq)
    print(f"Bad sequence Pop->Sek -- violations: {errs2}  (expected 1 error)")
    assert len(errs2) == 1

    print("\nXCFE OK.")
