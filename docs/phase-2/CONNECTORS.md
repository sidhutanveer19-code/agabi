# Connector & Parser Framework (W4)

Two orthogonal, open registries. Adding a source or a format is **data/a plugin, never an engine
change** — and **no copyrighted or live-network fetch is built in**.

## Sources — `ingest/connectors/registry.ts`
A `SourceConnector` says WHERE bytes come from. The catalog makes the plugin architecture explicit:

| id | status | note |
|---|---|---|
| `local-filesystem` | **available** | reads files from disk; operator asserts the licence (§24) |
| `wikipedia` | plugin-required | framework slot — supply a plugin |
| `government-curriculum` | plugin-required | official curriculum docs — plugin + assert licence |
| `academic-paper` | plugin-required | research papers — plugin + assert licence |
| `api` | plugin-required | structured API source — plugin |
| `crawler` | plugin-required | web crawler — plugin + robots/licence policy |

A **plugin slot** (`pluginSlotConnector(id, kinds)`) refuses at the licence gate (`permitted:false`),
so `acquire()` (licence-before-fetch, §24) stops it before a single byte — the copyright defence at
the front door. A real connector is a plugin that replaces the slot; the engine never changes.

## Formats — `ingest/parse/registry.ts`
A parser maps a `Format → (raw → Doc)`. `parseFormat(raw, format)` dispatches:

| format | status |
|---|---|
| `markdown` | functional (the import format) |
| `html` | functional (heading level lost — see PIPELINE.md) |
| `json` | functional — structured `{title, blocks:[{level,heading,text}]}` rendered to canonical markdown and reused through `parseMarkdown` (identical discovery + chunking) |
| `pdf` | **declared SLOT** — throws the E8/G6 deferred-dependency error until a real parser is registered with `registerParser("pdf", …)`. Adding a PDF lib is a stop-and-ask. |

The orchestrator detects the format from the source URI and calls `parseFormat`; `registerParser`
adds a format (e.g. a `pdf` plugin, a `txt` parser) without touching the engine.

Verified: `connectors/framework.test.ts` (6) — catalog contents + statuses, a slot refuses via
`acquire`, JSON parses to a Doc, `pdf` throws E8, `registerParser` extends the set.
