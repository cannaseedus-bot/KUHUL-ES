# K'UHUL-ES Grammars

This directory contains the formal EBNF grammars that define the K'UHUL-ES semantic runtime and its satellite formats.

| File | Purpose |
|------|---------|
| `kuhul-pi.ebnf` | Canonical K'UHUL π language: ECMAScript surface + phase glyphs + atomic blocks |
| `kast-1.ebnf` | KAST/1 — canonical JSON AST for K'UHUL programs |
| `kfold-1.ebnf` | KFOLD/1 — lazy semantic fold graph with vertical folds and linear lanes |
| `khl-rom-1.ebnf` | KHL/1 — Kernel Hyper Language ROM block grammar used in `sw.khl` |
| `xcfe-1.ebnf` | XCFE/1 — control, flow, and variable vector contract grammar |
| `xjson-1.ebnf` | XJSON/1 — extensible JSON with semantic `@` metadata and atomic blocks |
| `kxml-1.ebnf` | KXML/1 — declarative inference graphs + tool-aware Jinja chat templates |

## Architectural rule

The grammars collectively enforce the **locked boundary**:

- **Micronaut** (orchestration) chooses contexts, sequences, and layouts.
- **KUHUL π** (enforcement) defines law, collapses fields, and rejects illegal states.
- **Extrapolator** (expansion) produces narratives, metaphors, and analogies without altering collapse.

Crossing these boundaries in any grammar contradicts the proof.
