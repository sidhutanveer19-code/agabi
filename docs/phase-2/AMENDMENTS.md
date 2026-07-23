# Phase 2 — Amendments to the frozen architecture

The frozen documents live in `docs/phase-2/FINAL/`. Changing one requires a formal amendment
recording **what changed, which section, why, the failure that required it, and the regression test
that protects it**. This file is the register.

An amendment is not a design improvement. It is a repair forced by something the architecture got
wrong, evidenced by a measurement.

| # | Change | Section | Status |
|---|---|---|---|
| A-1 | Content-addressed ids preserved across re-ingest | §18A.5 | applied |
| A-2 | M0 knowledge-schema `db push` is a human-gated operation | §17, G7 | applied |
| A-4 | `pdf-parse` admitted as the one deferred dependency | E8/G6 | applied |
| **A-5** | **`subjectId` is the aboutness index, not the SPO index** | **§10 / `01-architecture.md:196`** | **applied** |
| **A-6** | **Extraction arrays cross the trust boundary element-wise** | **§14.1 (V1) / `extraction/schemas.ts`** | **applied** |

---

## A-5 — `subjectId` is the ABOUTNESS index, populated for every statement form

**Section.** `docs/phase-2/FINAL/01-architecture.md:196`

```
subjectId String?                // denormalised SPO index (form=SPO only)
```

**Change.** `subjectId` is populated for **every** statement form whenever a subject concept
resolves. `predicate` / `objectId` / `objectLit` keep their SPO-only denormalisation, and the
non-SPO forms still carry their shape in `structure`.

**The failure that required it.** A live population run over two NCERT chapters produced 358
concepts and 40 statements. Thirty-nine of those forty — every `DEFINITIONAL`, `CAUSAL`,
`QUANTIFIED` and `COMPARATIVE` statement — had `subjectId = NULL`, because `resolve.ts` only
resolved a subject when `form === "SPO"`.

`statementsForSubject()` is the only path from a concept to what is known about it, and the
`stmt_teachable` index (§18B) is on `(subjectId, contextId)`. So:

- 357 of 358 concepts returned **nothing** when asked what was known about them;
- `coverageRate` sat at 1/358 and looked like a content problem rather than a wiring one;
- the M5 teaching bridge could not retrieve knowledge for any concept in the graph.

The model was not at fault: it *does* name the subject for non-SPO forms — it writes it into
`structure.subject` (`{"subject":"The Fundamental Theorem of Arithmetic","predicate":"states that"}`).
The name was there and was thrown away.

**Why the architecture was wrong.** "SPO is ONE case" is right about *structure* and wrong about
*addressing*. Every statement is about something, whatever its logical form, and the graph has
exactly one column for "what is this about". Reserving it for one form of seven leaves six forms
addressable by nothing.

**Blast radius.** None at the storage layer: the column is already nullable and already indexed, so
there is **no migration**. `resolve.ts` reads `raw.subject ?? structure.subject` for all forms;
`buildStatement` takes an explicit `subjectId`; the idempotency check dedups on `(subjectId, text)`
for non-SPO forms as it already did on the SPO tuple.

**Regression tests.**
- `content/orchestrator.test.ts` — *"attaches a subjectId for EVERY statement form (amendment A-5)"*:
  three forms in, three reachable from their concept, `unattachedStatements === 0`.
- `content/orchestrator.test.ts` — *"records subject-unresolved rather than dropping or hiding it"*:
  a statement with no nameable subject is still persisted, and the omission is recorded with a reason.
- `knowledge/integrity.ts` reports `subjectAttachment` as a first-class metric with a ≥95% target,
  so a regression is visible in `npm run verify:graph`, not only in the test suite.

---

## A-6 — Extraction arrays cross the trust boundary ELEMENT-WISE

**Section.** §14.1 (V1, the trust boundary) — implemented in
`knowledge/extraction/schemas.ts` and `advisors/advice.ts`, which stated:

> Raw model output crosses into the platform ONLY by `accept(advice, schema)` — anything that does
> not match is **discarded as a batch, never partially trusted**.

**Change.** Extraction arrays are unwrapped with `acceptEach(advice, elementSchema)`, which keeps
the valid elements and reports each rejected one. Every element is still checked against the
identical schema; nothing unvalidated reaches the platform. **Only batch atomicity is relaxed, and
only for extraction arrays.** Single-object advice still goes through `accept()` unchanged.

**The failure that required it.** Measured, not inferred. Probing chunk 2 of NCERT *Real Numbers*
with `qwen2.5:7b` through the real prompt and the real schema, the model returned **eight
well-formed statements**. Element 0 carried `"form": "HISTORICAL"` — a value it invented, outside
the seven-value enum. `accept()` returned `null`; all eight were discarded.

Across the stalled run this showed up as:

| Measure | Value |
|---|---|
| Statements accepted per chunk | 2.5 (≈30 needed for M3's ~400/chapter) |
| Chunks that yielded nothing at all | 12 of 25 (48%) |
| Statements per chapter | 18 against a ~400 target |
| Assets / items per chapter on the *same* chunks | 30-36 / 39-49 — normal |

Assets and items yielded normally because their schemas are small. The statement schema is the
strict one, so it was the one that kept losing whole batches.

**Why the architecture was wrong.** Batch atomicity is the right rule when a batch is a *unit of
meaning* — a transaction, a review decision. An extraction array is not: it is N independent
proposals that happen to arrive together. Under the old rule the boundary was not protecting the
graph from bad data; it was deleting good data because a 7B local model cannot be relied on to keep
an enum straight. The trust guarantee — *nothing unvalidated is persisted* — is untouched.

**Second defect found in the same probe.** Local models write `"subject": null` rather than omitting
the key, and a bare `z.string().optional()` rejects `null`. That failed the element and, with it,
the statement's concept link (A-5). Optional strings in the extraction schemas now accept an
explicit `null` and map it to absent. Null means "not provided"; nothing is invented.

**Regression tests.**
- `content/orchestrator.test.ts` — *"keeps the valid proposals when one element is malformed"*:
  the exact real failure (`form:"HISTORICAL"` alongside two good statements) yields **2** persisted,
  where the old rule yielded 0, plus an `element-discard` omission carrying the index, the zod path
  and a preview containing `HISTORICAL`.
- `content/orchestrator.test.ts` — *"an explicit null … does not cost the statement its subject"*.
- `content/orchestrator.test.ts` — *"reports a chunk as barren, with the reason, when nothing
  survives"*: when everything genuinely fails, the chunk is still reported, with why.

---

## Not amendments

Recorded here so they are not mistaken for changes to frozen decisions:

- **Derived educational properties** (Bloom, confidence, difficulty, teaching priority, quality) are
  Inference-Layer read-time computations, never knowledge columns. See
  `ARCHITECTURAL-CLARIFICATION-derived-properties.md`. Nothing frozen changes.
- **`coverageRate` is an orphan rate, not curriculum breadth.** The metric was never wrong; its name
  invited a wrong reading. It is now documented for what it measures, and `corpusCoverage()` was
  added beside it for breadth. No frozen decision changed.
- **Extraction sampling pinned to temperature 0 with a fixed seed.** A tuning choice, not an
  architectural one — but it retires a limitation the plan had accepted (a live retry could
  paraphrase and defeat exact-text dedup, making re-ingest non-idempotent in practice while the
  idempotency test passed against a deterministic stub).
