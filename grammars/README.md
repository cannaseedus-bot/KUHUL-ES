# K'UHUL-ES Grammars

This directory contains the formal EBNF grammars that define the K'UHUL-ES semantic runtime and its satellite formats.

| File | Purpose |
|------|---------|
| `gml-1.ebnf` | GML/1 — Graph Map Language: fold-map topology substrate (B = authoritative discrete graph) |
| `kuhul-pi.ebnf` | Canonical K'UHUL π language: ECMAScript surface + phase glyphs + atomic blocks |
| `kast-1.ebnf` | KAST/1 — canonical JSON AST for K'UHUL programs |
| `kfold-1.ebnf` | KFOLD/1 — lazy semantic fold graph with vertical folds and linear lanes |
| `khl-rom-1.ebnf` | KHL/1 — Kernel Hyper Language ROM block grammar used in `sw.khl` |
| `xcfe-1.ebnf` | XCFE/1 — control, flow, and variable vector contract grammar |
| `xjson-1.ebnf` | XJSON/1 — extensible JSON with semantic `@` metadata and atomic blocks |
| `kxml-1.ebnf` | KXML/1 — declarative inference graphs + tool-aware Jinja chat templates |

### GML — Graph Map Language

GML is **not** graph machine learning. It is the **map function substrate** for K'UHUL fold operations:

- `B` (authoritative discrete topology) is a GML graph — nodes and typed edges
- The fold **map** (anamorphism/unfold) walks GML edges to generate fold-candidate structure
- `unfold-graph.gml` = Q3×C6 (3D hypercube × C6 phase cycle) — the phase-aware neighbor map the fold traverses
- `law: topology-before-coordinates` — GML graph shape precedes any learned geometry
- `law: GML != VECTOR` — VECTOR-µ learns geometry *over* B; it cannot redefine B
- Full grammar + C++ parser + conformance suite live in [micronaut-daemon](https://github.com/cannaseedus-bot/micronaut-daemon): `data/grammar/gml.khanary.ebnf`

`gml-1.ebnf` here is the fold-map interface contract (nodes, edges, relation verbs, WCR weights, phase/epistemic state). The extended Khanary grammar adds geodesic coordinates, Minkowski events, tensor bundles, quantum graphs, and training gradients.

## Architectural rule

The grammars collectively enforce the **locked boundary**:

- **Micronaut** (orchestration) chooses contexts, sequences, and layouts.
- **KUHUL π** (enforcement) defines law, collapses fields, and rejects illegal states.
- **Extrapolator** (expansion) produces narratives, metaphors, and analogies without altering collapse.

Crossing these boundaries in any grammar contradicts the proof.
