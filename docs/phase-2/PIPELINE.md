# Content Engineering Pipeline

The orchestration spine that drives a source through the factory. Kept current every milestone (W9).

## Where it lives — and why not `ingest/`

The orchestrator imports **both** `advisors/knowledge/*` (the extractors) **and** `knowledge/store`
(to persist). Two frozen walls forbid that in the obvious homes:
- **W3** — nothing under `ingest/` may import `knowledge/store`.
- **W2** — nothing under `knowledge/` may import `advisors/`.

So the orchestration layer lives in its own module, **`src/server/content/`**, which sits *above*
both the ingest stages and the knowledge substrate and is allowed to import each. `ingest/` stays
pure (bytes → chunks, no store); `knowledge/` stays pure (no advisors). This is recorded as
**ADR-12** in `ARCHITECTURE.md`.

## The stages (`content/orchestrator.ts` → `ingestSource`)

```
acquire ──► parse ──► clean ──► normalise ──► chunk ──► discover ──► [ per chunk:
  extract×6 ──► accept (trust boundary) ──► validate ──► resolve+persist ] ──► enqueued
```

| Stage | Calls (reused) | Event | Notes |
|---|---|---|---|
| acquire | `ingest/connector.acquire` | `ingest.acquired` | licence **before** fetch (§24); refusal throws `LicenseRefused` |
| parse | `ingest/pipeline.parse` | `ingest.parsed` | markdown/html; format from `source.uri` |
| clean → normalise | `ingest/{clean,normalise}` | `ingest.normalised` | pure span transforms |
| chunk | `ingest/chunk.chunkDoc` | `ingest.chunked` | `chunk.id` = sha256 → **resumable** (re-run skips unchanged) |
| discover | injected `Discover` (W2) | `ingest.discovered` | **structure only**; omitted → `hierarchy:null` |
| extract ×6 | `advisors/knowledge/extract*` | `ingest.extracted` | entities → accept → names → statements/deps/assets/items |
| accept | `advisors/advice.accept` | — | the trust boundary; a bad batch → `null` → dropped (no partial trust) |
| validate | `knowledge/validators` | `ingest.validated` | `summarise() === "REJECTED"` drops a proposal (e.g. a cycle) |
| resolve+persist | `content/resolve.Resolver` | `ingest.enqueued` | name→id, `putContext`, `buildStatement`, `putProvenance`, edges/assets/items |

## The resolve-and-persist bridge (`content/resolve.ts`)

The gap the audit found: extraction proposes **names** + a `contextDimensions` record;
`buildStatement` needs resolved **ids** + a `contextId`. `Resolver` closes it, per run:
- **name → conceptId** — reuse an existing concept by slug, else `buildConcept` a **DRAFT** concept
  (`putConcept`). A per-run `Map` makes one name resolve to one concept.
- **contextDimensions → contextId** — `store.putContext` (idempotent by hash).
- **statement** — build SPO structure with resolved ids → `buildStatement` (hard-codes
  `MACHINE_PROPOSED`) → `putStatement` + `putProvenance` (the verbatim `quote` is verification-only,
  **never served**, §27.1).
- **edges** — resolve names, run V7/V8/V10 acyclicity first; a rejected edge is never persisted.
- **assets/items** — resolve `conceptName` → `putTeachingAsset` / `putAssessmentItem` (+ link).

## Guarantees
- **Terminal state = MACHINE_PROPOSED in the store** — the review queue's pending set. **Nothing is
  auto-promoted** (§26.2). Proven: a fresh statement is admitted by `POLICIES.RND` (floor
  MACHINE_PROPOSED) but **refused** by `POLICIES.GENERAL_SCHOOL` — invisible to learners until review.
- **Append-only** (L5) · **one evidence event per stage** (replayable) · **store- and invoker-agnostic**
  (memory+fake in tests, postgres+Ollama live) · **deterministic** (same source → same chunk ids).

## Result
`ingestSource` returns an `IngestResult` — `{sourceId, source, format, chunks, hierarchy, outcomes[],
counts, stages[]}`. `outcomes[]` carries per-chunk `{statementsProposed, statementsPersisted, rejected,
barren}` — the input to coverage (W3). `stages[]` is the ordered event list (verification).

## Verified (W1)
`content/orchestrator.test.ts` — 3 tests: all 8 stage events fire in order; entities become DRAFT
concepts; a valid statement persists as MACHINE_PROPOSED and is refused to learners; deterministic
chunk ids. Full suite green (walls W1–W7 hold; taxonomy reciprocity holds for the 8 new events).
