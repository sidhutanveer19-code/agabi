# Backend Phase 2 — Content Engineering Infrastructure · Completion Report

**Status: the machinery is complete.** The universal engine that will create, validate, version, and
manage knowledge objects exists and is verified. No curriculum has been authored — that is data,
supplied later through this infrastructure. Adding a curriculum is now a data operation, not an
engineering project.

## What was built (9 workstreams, branch `conversation-architecture`)

| WS | Delivered | Commit |
|---|---|---|
| M0 | Gap analysis + architecture doc (engine ⟂ content boundary) | — |
| **W1** | Ingest **orchestrator** (`content/`) + resolve-and-persist bridge + 8 stage events | `7bea4c8` |
| **W2** | **Curriculum discovery** — structure only, profile-driven registry | `9d5c5b6` |
| **W3** | **Coverage** report (derived, ADR-11) + **quality runner** over scoreExtraction | `135ad05` |
| **W4** | **Connector + parser framework** — plugin architecture, PDF slot, source stubs | `78e0333` |
| **W5** | **Content import spec + curriculum package architecture** (`loadDataset`) | `56c9f5e` |
| **W8** | **Knowledge Authoring Workspace** — content-lifecycle state machine | `6f37190` |
| **W6/W7** | **Golden framework** + **detectors** (duplicate via trigram, missing via coverage) | `e89314d` |
| **W9** | Continuous docs (this dir): ARCHITECTURE · PIPELINE · CONNECTORS · CONTENT-IMPORT-SPEC · LIFECYCLE · EXTENSION-GUIDE · this report | across all |

## Engine vs data
- **Engine (built):** connectors, parsers, discovery, orchestrator, resolve/persist, validation
  (frozen), trust ladder (frozen), review (frozen), lifecycle, coverage, quality, golden framework,
  detectors, dataset loader. Curriculum-agnostic — the engine never names CBSE.
- **Data (supplied later):** curriculum profiles, dataset packages (`/datasets/`), golden truth sets,
  licensed source documents. One committed sample: `datasets/sample-science/` (synthetic, CC0).

## Verification
`npx tsc --noEmit` **0** · `npm run lint` **0 errors** (5 `_`-prefixed-param warnings, baseline) ·
`RUN_DB_CONFORMANCE=1 npx vitest run` **303 passed / 1 skipped** · `npm run build` **✓** · architecture
walls **W1–W7 green (12/12)** · taxonomy reciprocity green (8 new ingest events). No earlier test
weakened (G2). The 1 skip is the pg_trgm preflight (needs `DATABASE_URL` in the vitest process env).

**End-to-end proven:** the sample package travels Source → discovery (structure) → parse → normalise →
chunk → extract → validate → resolve+persist as **MACHINE_PROPOSED** (nothing auto-promoted: RND
admits, GENERAL_SCHOOL refuses) → coverage (byte-identical rebuild) → quality (100% on a golden) →
lifecycle DRAFT→IN_REVIEW→APPROVED→PUBLISHED (illegal jumps rejected). A second curriculum installs
with zero engine change.

## Architectural decisions recorded
**ADR-12** — the orchestration layer lives in `content/` (not `ingest/` or `knowledge/`) because it
imports both `advisors/` and `knowledge/store`, which walls W2/W3 forbid in those homes.

## Remaining risks (severity-ordered)
1. 🟡 **Live-model extraction unproven at quality.** Extraction is tested with a fake invoker (by
   design — free/offline). A live `qwen2.5` run over real content will have rough precision/recall;
   the golden framework + quality runner exist to measure it, but no real golden has been authored.
2. 🟡 **No CI gate** runs `RUN_DB_CONFORMANCE=1` or a live pipeline run — the Postgres + Ollama paths
   are proven manually, not continuously.
3. 🟢 **HTML structural discovery is flat** — `parseHtml` discards heading level; markdown fully
   covered. A `Span.headingLevel` parse enhancement closes it.
4. 🟢 **PDF is a slot** — a parser dependency (E8/G6) is a stop-and-ask before NCERT-style PDFs ingest.
5. 🟢 **Authoring UIs deferred** — the interactive editors/dashboards (W7 frontend) are a Phase-2.1
   track; the backend detectors + workspace queries are their substrate.

## Launch gates (unchanged, human/legal — not engineering)
- **§27.1 copyright** — every connector's `license()` gate + the manifest licence assertion are built;
  ingesting real copyrighted curricula is an operator/legal decision.
- **§27.2 DPDP minors' consent** — observation store (M8) enforces erasure; consent flow is product/legal.

## Phase-3 readiness
The exit condition holds: engineering gaps closed, pipeline works end-to-end, connector/dataset/
coverage/quality/lifecycle frameworks exist, docs are current, no architectural debt. **Future work is
adding data, curricula, and features — not redesigning infrastructure.** Recommended next: (1) author a
real golden + one licensed markdown chapter to measure live extraction; (2) a CI job for the live
paths; (3) the Phase-2.1 authoring UIs on top of the workspace + detectors.
