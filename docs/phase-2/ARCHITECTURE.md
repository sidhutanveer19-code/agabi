# Agabi Backend Phase 2 — Content Engineering Infrastructure

> **This is the machinery, not the content.** The engine, its connectors, its dataset contract, and
> its governance are what "complete" means here — never that a curriculum has been authored. Content
> is loaded later, as data, through this infrastructure. Adding a curriculum is a *data operation*,
> never new architecture.

This document is kept **current every milestone** (W9). If code and this doc disagree, that is a bug
in the doc — fix it in the same milestone.

---

## 1. The engine ⟂ content boundary

```
        ENGINE (this phase — universal, curriculum-agnostic)        │   CONTENT (later — data)
 ───────────────────────────────────────────────────────────────── │ ─────────────────────────
 connectors · discovery · pipeline · extraction · validation ·      │  /datasets/{id}/ packages
 trust ladder · review · lifecycle · coverage · quality · golden    │  curriculum profiles
 framework · health · evidence                                      │  golden truth sets
                                                                    │  licensed source docs
```

The engine **never names a curriculum**. CBSE, JEE, NEET, ICSE, IB, Medicine, Law are *profiles +
dataset packages* that plug in. No copyrighted material is embedded in the repo. PDF / Wikipedia /
government / academic connectors are **framework + plugin slots**, not fetchers.

## 2. What already exists (frozen substrate, M0–M9)

Verified on branch `conversation-architecture`, 270 tests / 1 gated-skip green:

| Layer | Modules | Status |
|---|---|---|
| Store + schema + tenancy | `knowledge/store/**`, `prisma/schema.prisma` (24 tables live) | frozen |
| Ingest **stages** | `ingest/{spans,clean,normalise,chunk,pipeline}.ts`, `parse/{markdown,html,pdf-stub}.ts` | frozen |
| Connector (single iface) | `ingest/connector.ts`, `connectors/localFilesystem.ts` | extend |
| Extractors (6) | `advisors/knowledge/extract*.ts`, `invoke.ts` (free Ollama) | frozen |
| Trust boundary | `advisors/advice.ts` (`accept()`), `extraction/schemas.ts` | frozen |
| Validators | `knowledge/validators/**` (V1–V15) | frozen |
| Trust ladder + review | `knowledge/trust/**`, `knowledge/review/**` | frozen |
| Teaching / assessment | `knowledge/teaching/**`, `knowledge/assessment/**` | frozen |
| Observation (sep. DB) | `observation/**` | frozen |
| Evidence + health | `events.ts`, `evidence/**`, `health/**` | extend reciprocally |
| Releases / replay | `knowledge/version.ts`, `knowledge/replay.ts` | reuse |

## 3. Confirmed gaps (Milestone-0 audit — 2 Explore agents)

| # | Gap | Evidence | Closed by |
|---|---|---|---|
| G1 | **No orchestrator** — stages ↔ extractors ↔ store unconnected | `pipeline.ts` stops at `Chunk[]`; extractors imported only by their test | **W1** |
| G2 | **No curriculum discovery** | zero `detect{Subject,Chapter,Topic}`; `classifySubject` is UI accent routing | **W2** |
| G3 | **No coverage / quality runner** | no `coverage.ts`; `scoreExtraction` (golden.ts:27) has no caller | **W3** |
| G4 | **No connector framework** | one `SourceConnector` iface, no registry/plugins | **W4** |
| G5 | **No dataset contract / package arch** | nothing defines what a curriculum package is | **W5** |
| G6 | **No golden framework** | `GoldenTruth` type only; no validation/authoring/scoring machinery | **W6** |
| G7 | **No detectors / reporting** | no missing-concept / duplicate detectors wired | **W7** |
| G8 | **No content lifecycle state machine** | publication states (Draft…Archived) implicit, ungoverned | **W8** |
| G9 | **Docs trail code** | design PDFs + FINAL/ only; no living module/pipeline/spec docs | **W9** |

**Structural sub-finding (shapes W2):** the parse layer does not preserve heading level. `Span`/`Chunk`
carry `{text, page, range, ordinal}` only. Markdown `#/##/###` survive as literal text (discovery
works for `.md`); `parseHtml` discards heading level (a future `Span.headingLevel` enhancement,
flagged, not built now).

**Non-gaps we do NOT bypass:** no source content, PDF parser deferred (E8/G6), copyright (§27.1), no
golden truth — all *content/legal/data*, supplied later; none block engine engineering.

## 4. Module map after this phase (target)

```
content/                 NEW orchestration layer — above ingest/ AND knowledge/ (see ADR-12)
  orchestrator.ts        W1  ingestSource() — the missing spine
  resolve.ts             W1  RawStatement(names) → resolved Concept/Statement/Provenance persist
ingest/
  discovery/             W2  structural detection (no meaning) + CurriculumProfile registry
    types.ts (W1 seam), profile.ts, profiles/, hierarchy.ts
  connectors/            W4  registry + markdown/html/json + pdf/wikipedia/gov/academic slots
  dataset/               W5  import spec zod schemas + loadDataset()
knowledge/
  coverage.ts            W3  derived coverage report (ADR-11)
  lifecycle/             W8  states + transition matrix + workspace queries
    lifecycle.ts, transition.ts, workspace.ts
  extraction/golden/     W6  golden schema + validation + scoring machinery
  detect/                W7  missing-concept + duplicate detectors
scripts/
  quality.mjs            W3  scoreExtraction runner
datasets/                W5  installable curriculum packages (data, not engine)
docs/phase-2/            W9  ARCHITECTURE · PIPELINE · CONNECTORS · CONTENT-IMPORT-SPEC ·
                            LIFECYCLE · EXTENSION-GUIDE · COMPLETION-REPORT (+ ADR log)
```

## ADR log (this phase)

**ADR-12 · The orchestration layer lives in `content/`, not `ingest/` or `knowledge/`.**
*Decision.* `ingestSource` + `Resolver` live in a new top-level `src/server/content/`.
*Why.* The orchestrator must import both `advisors/knowledge/*` (extractors) and `knowledge/store`
(to persist). Wall **W3** forbids `ingest/`→`knowledge/store`; wall **W2** forbids
`knowledge/`→`advisors/`. No existing home is legal. A layer *above* both — `content/` — imports each
without weakening either wall (`ingest/` stays store-free, `knowledge/` stays advisor-free).
*Guarded by.* `architecture.test.ts` W2–W7 stay green; `content/` is deliberately unconstrained.

## 5. Invariants carried forward (unchanged)
Append-only, no delete (L5) · nothing above `AUTO_VALIDATED` without a human `ReviewEvent` (§26.2) ·
`Provenance.quote` never served (§27.1) · scope filtered inside the store (§23) · Prisma only in
`store/**` (W5-wall) · conclusions derived not stored (ADR-11) · trust never claimed by a producer
(ADR-2) · every ingest stage emits evidence.
