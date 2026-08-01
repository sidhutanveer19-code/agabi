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

---

## Adding a step that can DROP something

The pipeline's R1 rule: **nothing is discarded without a record of why.** If your extension can
reject, filter, collapse or skip anything, it must append an `Omission`
(`src/server/content/omissions.ts`) rather than only incrementing a counter.

```ts
import type { Omission } from "@/server/content/omissions";

omissions.push({
  stage: "validate",          // convert | accept | validate | resolve | persist | chapter
  kind: "statement-rejected", // add a new kind to OmissionKind if none fits
  chunkId: chunk.id,
  reason: "V12: UNITS_MISMATCH — 'kg' where the dimension registry expects a length",
  data: { gate: "V12", text: proposal.text.slice(0, 160) },
});
```

The reason must be specific enough that a reader can decide whether the drop was correct without
re-running the pipeline. `"rejected"` is not a reason; `"V3: QUOTE_NOT_IN_SOURCE"` is.

Records flow automatically from there: `IngestResult.omissions` → the `ingest.omitted` event →
`.population-run.json` in the dataset dir → `reports/population-run.json` inside an exported
Knowledge Package → the tables in `KNOWLEDGE-POPULATION-REPORT.md`.

## Adding a new store method

`KnowledgeStore` is implemented twice (memory + Postgres) and the conformance suite runs the
**identical** contract against both. So:

1. Add the method to `KnowledgeStore.ts` with a comment saying why it exists.
2. Implement it in `store/memory.ts` and `store/postgres.ts`.
3. Add it to `store/conformance.ts` — assert *membership*, not exact counts: the Postgres suite
   shares one database across its cases, so a count assertion tests isolation, not your method.
4. Run both engines:
   ```bash
   npx vitest run src/server/knowledge/store/conformance.test.ts
   RUN_DB_CONFORMANCE=1 DATABASE_URL=postgresql://…/scratch_db \
     npx vitest run src/server/knowledge/store/conformance.test.ts
   ```

If the new method reads whole tables, add it to `dumpAll()` as well, or an exported Knowledge
Package will silently restore an incomplete graph.

## Adding a validator gate

A gate returns a `ValidationResult` with a `validator` id, an `outcome`, and — for anything that is
not a pass — a `reason`. The orchestrator records that reason verbatim in the omission, and the
review CLI shows it to the reviewer, so the reason string is user-facing text, not a debug note.

Passing **every** applicable gate is what makes a statement `AUTO_VALIDATED` (§14), so adding a gate
raises the bar for the machine ceiling. That is intended; just be aware a gate that flags liberally
will hold statements at `MACHINE_PROPOSED` and grow the review queue.
