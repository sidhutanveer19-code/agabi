# Extension Guide — adding data, not architecture

The whole point of this infrastructure: **future work is adding data/curricula/features, not
redesigning the engine.** Each extension below is a file or a package, never an engine change.

## Add a curriculum (CBSE, JEE, NEET, IB, …)
1. **Profile** (optional, if the structure differs from generic): create
   `ingest/discovery/profiles/<id>.ts` — a `CurriculumProfile` (heading-level map + optional subject
   regex rules) — and `registerProfile(it)`. Data, not logic.
2. **Package**: create `datasets/<id>/` with a `manifest.json` (see CONTENT-IMPORT-SPEC.md) pointing
   at markdown/html/json source files, and assert the licence in the manifest.
3. **Install**: `loadDataset("datasets/<id>", store, invoke)`. Done — proposals land MACHINE_PROPOSED
   for review. No engine code changes.

## Add a source connector (Wikipedia, a government API, a crawler)
Replace the framework slot: implement the `SourceConnector` interface (`license()` first, then
`fetch()`), and `registerConnector({ id, kinds, status: "available", note })`. `license()` MUST refuse
un-licensed content — that is the §27.1 front-door gate. No engine change.

## Add a format (a real PDF parser, a new markup)
`registerParser("<format>", (raw, page) => Doc)` (CONNECTORS.md). For PDF specifically: adding the
parser library is the one stop-and-ask dependency (E8/G6); once approved, register it and the `pdf`
slot becomes live. No engine change.

## Add a golden truth (to score a chapter's extraction)
Author `datasets/<id>/golden.json` conforming to `GoldenTruthSchema` (W6). Score with
`npx tsx scripts/quality.ts golden.json proposals.json source.txt` or `scoreRun(...)`. Records, never
gates.

## Add a knowledge-object kind, trust level, validator, or graph
These are the frozen substrate's own extension points (M0–M9) — a new registry entry / ladder rung /
validator, each guarded by an invariant test. Out of scope here; see `FINAL/01-architecture.md`.

## What you should NOT have to do
Touch `content/orchestrator.ts`, the walls, the store, the trust ladder, or the schema to onboard a
curriculum. If onboarding data requires an engine change, that is a bug in this infrastructure —
report it.
