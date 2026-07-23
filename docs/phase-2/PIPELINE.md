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

## Curriculum Discovery (W2) — `ingest/discovery/`

Structure only. Answers *"what is this document and where is everything located?"* — never meaning
(no concepts/objectives/difficulty). Pure + deterministic, so it lives under `ingest/` (no store, no
advisors).

- **`hierarchy.ts`** — detects markdown headings **per line** (parse groups consecutive non-blank
  lines, so a heading can share a span with prose above it) and nests them into
  `Document → Chapter → Section → Subsection → Topic`, each node carrying its source span + page.
- **`profile.ts`** — the "curriculum is DATA, not code" seam: a `CurriculumProfile` maps heading
  level → structural level and (optionally) names the subject via deterministic regex rules. Open
  registry (`registerProfile`), same pattern as context dimensions / blocks. Adding CBSE/JEE/NEET =
  **a new profile file, never an engine change**. The `generic` profile ships and is the default.
- Runs on the **parsed** (pre-clean) doc so `#` headings are pristine. Default-on in the orchestrator;
  injectable via `opts.discover`.
- **Recorded limitation:** `parseHtml` discards heading level → HTML yields a flat hierarchy; markdown
  (the import format) is fully covered. A future `Span.headingLevel` field closes the HTML gap.

Verified: `discovery/discovery.test.ts` (5) — nesting, subject-null under generic, profile-driven
subject naming, determinism, empty-doc safety.

## Result
`ingestSource` returns an `IngestResult` — `{sourceId, source, format, chunks, hierarchy, outcomes[],
counts, stages[]}`. `outcomes[]` carries per-chunk `{statementsProposed, statementsPersisted, rejected,
barren}` — the input to coverage (W3). `stages[]` is the ordered event list (verification).

## Coverage & Quality (W3)

**Coverage — `knowledge/coverage.ts`** · `coverageReport(store, scope, policy)`. Derived, never
stored (ADR-11), rebuildable **byte-identical** (sorted id lists → deterministic). Two axes: concept
coverage (a concept is covered if it is the subject of ≥1 statement; the rest are orphans) and
grounding (a statement is grounded if it has ≥1 provenance). This is the number the M3/M7 gates and
the missing-concept detector (W7) consume. Pure store query — no new table.

**Quality — `content/quality.ts` + `scripts/quality.ts`** · `scoreRun(proposals, text, golden)` wraps
the existing `scoreExtraction` (precision / recall / grounding / duplicate) over a whole run's
accepted proposals vs a hand-authored golden truth. It **records, never gates** (§5.3). Feed it
`IngestResult.proposals` + `.text` (from `opts.collectProposals`). CLI:
`npx tsx scripts/quality.ts <golden.json> <proposals.json> <source.txt>`.

## Verified (W1)
`content/orchestrator.test.ts` — 3 tests: all 8 stage events fire in order; entities become DRAFT
concepts; a valid statement persists as MACHINE_PROPOSED and is refused to learners; deterministic
chunk ids. Full suite green (walls W1–W7 hold; taxonomy reciprocity holds for the 8 new events).
