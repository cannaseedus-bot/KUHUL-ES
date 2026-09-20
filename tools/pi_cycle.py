"""
pi_cycle.py — K'UHUL π-cycle engine.

Evaluates π-cycle expressions from the unified grammar:
  ◎name = @sin(π·x)
  ◎wave = ◎sine → @shift(0.5π)
  ◎mix  = @blend(◎a, ◎b, 0.5)

All computations are π-normalized: sin/cos/tan operate on π·x
so sin(1.0) = sin(π) = 0, cos(0.5) = cos(π/2) = 0, etc.
"""

from __future__ import annotations

import math
import re
from typing import Any, Callable

# π constants
PI = math.pi
TAU = 2 * math.pi
HALF_PI = math.pi / 2
PHI = (1 + math.sqrt(5)) / 2


# ---------------------------------------------------------------------------
# π-cycle function registry
# ---------------------------------------------------------------------------

def _sin(x: float) -> float:
    """π-normalized sine: sin(π·x). sin(0)=0, sin(0.5)=1, sin(1)=0"""
    return math.sin(PI * x)

def _cos(x: float) -> float:
    """π-normalized cosine: cos(π·x). cos(0)=1, cos(0.5)=0, cos(1)=-1"""
    return math.cos(PI * x)

def _tan(x: float) -> float:
    """π-normalized tangent: tan(π·x)."""
    return math.tan(PI * x)

def _cycle(x: float) -> float:
    """Cycle/frac: fractional part of x. cycles(x) in [0, 1)."""
    return x - math.floor(x)

def _shift(x: float, phase: float = 0.0) -> float:
    """Phase shift: x → x + phase. phase in π units."""
    return x + phase

def _wrap(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    """Wrap x into [lo, hi] cyclically."""
    r = hi - lo
    if r == 0: return lo
    return lo + ((x - lo) % r)

def _blend(a: float, b: float, t: float = 0.5) -> float:
    """Linear blend: (1-t)·a + t·b. t in [0,1]."""
    return (1 - t) * a + t * b

def _modulate(carrier: float, modulator: float) -> float:
    """Amplitude modulation: carrier * (1 + modulator) / 2."""
    return carrier * (1 + modulator) / 2

def _resonate(a: float, b: float, ratio: float = 1.0) -> float:
    """Resonance: a * sin(π · b · ratio)."""
    return a * math.sin(PI * b * ratio)


# Map of @function names to (callable, arity, has_phase)
PI_FUNCTIONS: dict[str, tuple[Callable, int, bool]] = {
    "@sin":       (_sin,      1, False),
    "@cos":       (_cos,      1, False),
    "@tan":       (_tan,      1, False),
    "@cycle":     (_cycle,    1, False),
    "@shift":     (_shift,    2, True),   # phase arg optional
    "@wrap":      (_wrap,     3, True),   # lo, hi args optional
    "@blend":     (_blend,    3, False),
    "@modulate":  (_modulate, 2, False),
    "@resonate":  (_resonate, 3, True),   # ratio arg optional
}


# ---------------------------------------------------------------------------
# π-cycle expression parser
# ---------------------------------------------------------------------------

# Regex for extracting π-cycle definitions from .kuhul source
# Matches:  ◎name = @sin(π·x)   or   ◎name = @blend(◎a, ◎b, 0.5)
_CYCLE_RE = re.compile(
    r'◎(\w+)\s*=\s*'
    r'(@\w+)\s*\(\s*(.*?)\s*\)\s*;?'
)

# Reference to another cycle: ◎name
_REF_RE = re.compile(r'◎(\w+)')

# π constant literal: π, 2π, π/2, φ
_PI_CONST_RE = re.compile(r'(\d*\.?\d*)?(π|τ|φ)(\/(\d+))?')

# Simple value: number or π-expression
_VALUE_RE = re.compile(r'^[\d\.πτφ\*\/\-\+◎\s]+$')


def _eval_pi_expr(expr: str, env: dict[str, float]) -> float:
    """Evaluate a π-cycle expression with the given environment."""
    expr = expr.strip()

    # Pure number
    try:
        return float(expr)
    except ValueError:
        pass

    # Reference to another cycle
    ref_m = _REF_RE.match(expr)
    if ref_m:
        name = ref_m.group(1)
        # Check both bare name and ◎-prefixed name
        if name in env:
            return env[name]
        prefixed = f"\u25ce{name}"
        if prefixed in env:
            return env[prefixed]
        raise ValueError(f"Unknown cycle: {name}")

    # π-constant expression: π, 2π, π/2, 0.5π
    cons_m = _PI_CONST_RE.match(expr)
    if cons_m:
        coeff = float(cons_m.group(1) or "1")
        const_str = cons_m.group(2)
        div = int(cons_m.group(4)) if cons_m.group(4) else 1
        const_val = {"π": PI, "τ": TAU, "φ": PHI}.get(const_str, PI)
        return coeff * const_val / div

    # Try evaluating as a simple arithmetic expression
    # Replace π, ◎refs with numbers
    safe = expr.replace("π", str(PI)).replace("φ", str(PHI)).replace("τ", str(TAU))
    for name, val in env.items():
        safe = safe.replace(f"◎{name}", str(val))
    try:
        return eval(safe, {"__builtins__": {}}, {"sin": math.sin, "cos": math.cos,
                    "tan": math.tan, "sqrt": math.sqrt, "abs": abs,
                    "min": min, "max": max, "pi": PI})
    except Exception:
        raise ValueError(f"Cannot evaluate π-expression: {expr}")


def _parse_args(args_str: str, env: dict[str, float]) -> list[float]:
    """Split comma-separated args and evaluate each."""
    if not args_str.strip():
        return []
    parts = []
    depth = 0
    current = ""
    for ch in args_str:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(current.strip())
            current = ""
        else:
            current += ch
    if current.strip():
        parts.append(current.strip())
    return [_eval_pi_expr(p, env) for p in parts]


# ---------------------------------------------------------------------------
# π-cycle graph
# ---------------------------------------------------------------------------

class PiCycleGraph:
    """
    A graph of π-cycle definitions.

    Parses expressions like:
        ◎carrier = @sin(π·x * 10);
        ◎signal = @modulate(◎carrier, ◎modulator);
    into a dependency graph and evaluates them in order.
    """

    def __init__(self):
        self._defs: dict[str, dict] = {}   # name -> {fn, arity, args_raw}
        self._values: dict[str, float] = {}  # name -> current value
        self._deps: dict[str, list[str]] = {}  # name -> [dep names]

    def parse(self, source: str) -> int:
        """Parse π-cycle definitions from source text. Returns count parsed."""
        count = 0
        for match in _CYCLE_RE.finditer(source):
            name = match.group(1)
            fn_name = match.group(2)
            args_raw = match.group(3)

            fn_info = PI_FUNCTIONS.get(fn_name)
            if fn_info is None:
                print(f"  [π-cycle] unknown function: {fn_name}")
                continue

            fn, arity, _ = fn_info

            # Extract dependency references
            deps = []
            for ref_m in _REF_RE.finditer(args_raw):
                deps.append(ref_m.group(1))

            self._defs[name] = {
                "name": name,
                "fn": fn,
                "fn_name": fn_name,
                "arity": arity,
                "args_raw": args_raw,
                "deps": deps,
            }
            self._deps[name] = deps
            count += 1

        return count

    def evaluate(self, x: float = 0.0, y: float = 0.0, t: float = 0.0,
                 env_extra: dict[str, float] | None = None) -> dict[str, float]:
        """
        Evaluate all cycles at given x, y, t coordinates.

        Returns dict of cycle_name → computed_value.
        """
        # Topological sort by dependency
        visited: set[str] = set()
        order: list[str] = []

        def visit(name: str):
            if name in visited:
                return
            visited.add(name)
            for dep in self._deps.get(name, []):
                visit(dep)
            order.append(name)

        for name in self._defs:
            visit(name)

        # Build evaluation environment
        env = {"x": x, "y": y, "t": t, "time": t}
        if env_extra:
            env.update(env_extra)

        # Evaluate in dependency order
        for name in order:
            entry = self._defs[name]
            args_raw = entry["args_raw"]
            fn = entry["fn"]
            arity = entry["arity"]

            # Parse and evaluate arguments
            args = _parse_args(args_raw, env)

            # Pad args to full arity with defaults
            while len(args) < arity:
                args.append(0.0)
            args = args[:arity]

            # Compute
            try:
                val = fn(*args)
                self._values[name] = val
                env[name] = val
                env[f"\u25ce{name}"] = val
            except Exception as e:
                print(f"  [π-cycle] error evaluating ◎{name}: {e}")
                self._values[name] = 0.0

        return dict(self._values)

    def get(self, name: str) -> float | None:
        return self._values.get(name)

    def __getitem__(self, name: str) -> float:
        return self._values.get(name, 0.0)

    def __contains__(self, name: str) -> bool:
        return name in self._defs

    def names(self) -> list[str]:
        return list(self._defs.keys())

    def __repr__(self) -> str:
        return f"PiCycleGraph({len(self._defs)} cycles: {', '.join(self.names())})"


# ---------------------------------------------------------------------------
# π-cycle REPL entry
# ---------------------------------------------------------------------------

def repl_cycle():
    """Interactive π-cycle evaluator REPL."""
    graph = PiCycleGraph()
    print("  π-cycle REPL")
    print("  Define:  ◎name = @sin(π·x)")
    print("  Evaluate: eval x=0.5 t=1.0")
    print("  Functions: @sin @cos @tan @cycle @shift @wrap")
    print("             @blend @modulate @resonate")
    print("  Exit: exit\n")

    while True:
        try:
            line = input("  > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not line or line == "exit":
            break

        if line.startswith("eval"):
            env = {}
            for part in line[4:].split():
                if "=" in part:
                    k, v = part.split("=")
                    try:
                        env[k] = float(v)
                    except ValueError:
                        pass
            results = graph.evaluate(**env)
            for name, val in sorted(results.items()):
                print(f"    ◎{name} = {val:.6f}")
            continue

        count = graph.parse(line)
        if count > 0:
            print(f"  parsed {count} cycle(s)")
            # Evaluate with current defaults
            results = graph.evaluate()
            for name, val in sorted(results.items()):
                print(f"    ◎{name} = {val:.6f}")
        else:
            print(f"  no cycles parsed (use ◎name = @fn(...))")


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def test():
    print("=== π-cycle engine self-test ===\n")

    graph = PiCycleGraph()
    count = graph.parse("""
        ◎carrier = @sin(π·x * 10);
        ◎modulator = @cos(π·y * 8 + t);
        ◎signal = @modulate(◎carrier, ◎modulator);
        ◎phase = @shift(◎signal, 0.33π);
        ◎wrap_test = @wrap(◎phase);
    """)

    print(f"Parsed {count} cycles: {graph.names()}")
    assert count == 5

    # Evaluate at specific point
    results = graph.evaluate(x=0.25, y=0.125, t=0.5)
    print(f"\nAt (x=0.25, y=0.125, t=0.5):")
    for name, val in sorted(results.items()):
        print(f"  ◎{name:<12s} = {val:.6f}")
        assert isinstance(val, float), f"◎{name} not float: {type(val)}"

    # Pure value tests
    graph2 = PiCycleGraph()
    graph2.parse("""
        ◎sin0 = @sin(0);
        ◎cos0 = @cos(0);
        ◎cycle0 = @cycle(3.7);
        ◎blend_test = @blend(1.0, 2.0, 0.5);
    """)
    r = graph2.evaluate()
    print(f"\nPure value tests:")
    print(f"  ◎sin(0)       = {r['sin0']:.6f}  (expect 0.0)")
    print(f"  ◎cos(0)       = {r['cos0']:.6f}  (expect 1.0)")
    print(f"  ◎cycle(3.7)   = {r['cycle0']:.6f}  (expect 0.7)")
    print(f"  ◎blend(1,2,0.5) = {r['blend_test']:.6f}  (expect 1.5)")
    assert abs(r['sin0']) < 1e-10
    assert abs(r['cos0'] - 1.0) < 1e-10
    assert abs(r['cycle0'] - 0.7) < 1e-10
    assert abs(r['blend_test'] - 1.5) < 1e-10

    print("\n  All self-tests passed.")


if __name__ == "__main__":
    import sys
    if "--repl" in sys.argv:
        repl_cycle()
    else:
        test()
