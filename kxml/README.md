# KXML Assets

Bundled KHANARY KXML metadata used by `kuhul-es kxml run` and the browser runtime.

| File | Purpose |
|---|---|
| `nodes.json` | Canonical KXML compute node types (ATTENTION, FFN, LAYERNORM, EMBED, LM_HEAD, LOSS, FIELD_OPTIMIZER) with phase/domain/gravity mapping. |
| `alignment.json` | Maps KXML tools to glyph tokenizer tokens and KXML compute nodes to K'UHUL glyphs. |
| `chat_template.json` | KXML chat template spec with example dialogue. |
| `chat_template.jinja` | llama.cpp-compatible Jinja surface for the same template. |

These are copies of `models/khanary-kxml-v0.5.0/` from the parent KHΛNARY project,
kept here so the npm/browser package is self-contained.
