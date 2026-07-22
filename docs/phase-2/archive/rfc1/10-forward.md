# Part X — Forward

---

# 46. Future AI Integration

## 46.1 The rule that does not change 🔒

> A model may **propose**. A model may **render**. A model may **judge, when its judgement is measured**. A model may never **assert**.

Every future AI capability is placed against that line.

| Capability | Role | Permitted | Gate |
|---|---|---|---|
| concept extraction | proposer | ✅ Phase 2 | human review |
| relationship extraction | proposer | ✅ Phase 2 | human review |
| assessment generation | proposer | ✅ Phase 2 | human review |
| lesson rendering | renderer | ✅ Phase 2 | statements are given, not invented |
| duplicate suggestion | proposer | ✅ 2C | human merge decision |
| translation | proposer | later | review in target language |
| difficulty estimation | **estimator over evidence** | Phase 3 | derived, not authored |
| open-response marking | **judge** | Phase 3+ | measured against human marks first |
| tutoring dialogue | renderer | Phase 3 | grounded in retrieved statements |
| curriculum alignment | proposer | later | human confirms mapping |
| autonomous knowledge agents | proposer | later | **still human review** |

The last row is the one that matters. Whatever agents become capable of, the door into `VERIFIED` stays human (§24.2). If that changes, it changes as an explicit, argued decision — never as a throughput optimisation.

## 46.2 What the graph gives future AI

The graph is a **retrieval substrate that beats a vector index for this workload**, because it carries structure a vector index cannot:

- Prerequisites — *what must be explained first*
- Context — *which version of the truth applies here*
- Provenance — *citable grounding, already verified*
- Relationships — *what to contrast, what is analogous*
- Assessment linkage — *how to check understanding*

Retrieval-augmented generation over unstructured chunks retrieves *text that resembles the query*. Retrieval over this graph returns *verified statements with their dependencies and their scope*. That difference is the entire reason for the phase.

## 46.3 Evidence as a training corpus

Accumulating, and each has a named future consumer:

| Corpus | Trains |
|---|---|
| `ReviewEvent` approve/reject/edit | a better extractor (§24.3) |
| Golden set | extractor evaluation (§44.5) |
| Assessment responses | difficulty and misconception models |
| Grounded vs ungrounded lesson quality | whether grounding helps, and where |
| `knowledge.miss` | coverage priority |

This is why review decisions are stored as structured evidence rather than as a boolean. A thousand human corrections is a training set; a thousand `approved: true` flags is not.

---

# 47. Phase-by-Phase Implementation Plan

Each phase compiles, passes tests, preserves the walls, and requires no rewrite of its predecessor.

---

## Phase 2A — Spine and one chapter

**Goal:** a real student sees a grounded lesson.

| Build | Detail |
|---|---|
| Schema | `Concept`, `Statement`, `Context`, `Edge`, `ConceptAlias`, `ConceptTag`, `Source`, `SourceChunk`, `Provenance`, `ReviewEvent` |
| `knowledge/` | `ids`, `concept`, `statement`, `context`, `relationship`, `graph` (closure + cycle detection), `review`, `store/KnowledgeStore` + Postgres impl + conformance suite |
| `objectTypes/` | registry + `FACT`, `PROCEDURE` |
| `ingest/` | span-preserving parse/clean/normalise/chunk for PDF and Markdown |
| `advisors/knowledge/extract.ts` | single-pass extraction, `PROMPT_VERSION` |
| Validation | V1–V12 |
| Review | **CLI only.** No UI. |
| Content | **one chapter** — NCERT Class 10 Science, Life Processes |
| Tests | dag, grounding, provenance, verification-door, identity, empty-graph, conformance, determinism |
| **Golden set** | hand-author the same chapter as ground truth |

**Target:** ~150 concepts, ~400 statements, all `VERIFIED`.

✅ **Done when** `selectPath("photosynthesis")` returns real concepts, a student sees a lesson where every block traces to a concept id, and dropping every program row leaves it working.

**Falsification:** if this takes more than a few weeks, the review tooling assumption (§36.1) is wrong and the plan must change before scaling content.

---

## Phase 2B — The bridge

| Build | Detail |
|---|---|
| `path.ts` | `selectPath` with banding and budget |
| `outlineFrom()` | statements → `OutlineSlot[]` |
| `manager.ts` | the one call site (§26.3) |
| Grounded prompt | §26.4 |
| Fallback | `knowledge.miss` events, `defaultOutline` path preserved |
| Evidence | `grounded`, concept ids, versions, release recorded per lesson |

✅ **Done when** grounded and ungrounded lessons are indistinguishable in *shape*, distinguishable in *evidence*, and comparable on quality.

---

## Phase 2C — Review at scale

| Build | Detail |
|---|---|
| Review UI | batch screen, source pane, highlight ranges (§36.2) |
| Queue | leverage + demand ordering (§36.3) |
| Merge | duplicate queue, side-by-side, tombstones |
| Extractor eval | golden-set scoring in CI |
| Multi-pass extraction | if measurement justifies it (§11.5) |

✅ **Done when** 100 statements can be reviewed in under an hour.

---

## Phase 2D — Search and curriculum

| Build | Detail |
|---|---|
| Search | rungs 1–3, `pg_trgm` |
| Program layer | `Program`, `ProgramNode`, `Mapping`, `LearningObjective` |
| CBSE Class 10 tree | all nine subjects, mapped for reviewed chapters |
| Closure cache | §31.2 |
| pgvector | **only if** rung 3 measurably insufficient |

✅ **Done when** a student browses to a chapter and every concept in it is teachable.

---

## Phase 2E — Breadth and the third kind

| Build | Detail |
|---|---|
| `SKILL` type | payload, rubric, exemplars |
| `ASSESSMENT_ITEM` | MCQ, SHORT, NUMERIC, ORDERING; distractor diagnosis |
| Content | remaining Science → Maths (`PROCEDURE` gets its first real workout) → Social Science → English (`SKILL` gets its first real workout) |

✅ **Done when** every subject has at least one fully verified chapter — proving the model holds across all three knowledge kinds, which is the real test of §13.

---

## Phase 2F — Versioning and releases

| Build | Detail |
|---|---|
| Version chains | supersedes, deprecation, disputes |
| `Release` / `ReleaseMember` | pinning |
| Point-in-time reads | `at` on every store method |
| Re-ingestion | edition diffing (§11.6) |
| Cascading review | §38.2 |

✅ **Done when** a lesson from three months ago replays with the exact statement text the student saw.

---

## Sequencing constraints

```
2A ──▶ 2B ──▶ 2C ──▶ 2D ──▶ 2E ──▶ 2F ──▶ Phase 3
 │      │      │
 │      │      └─ 2C may start once 2A produces a real queue
 │      └─ 2B needs 2A's concepts
 └─ blocked on: Observability Stage A reconstruction proof
```

**2A does not start until the evidence spine's reconstruction proof passes.** Grounding without measurement means no way to know whether it helped, and §4.7 identifies that as a genuine failure mode.

## Effort 🔬

| Phase | Engineering | Content review |
|---|---|---|
| 2A | 3–4 weeks | 4–6 hours (one chapter) |
| 2B | 1 week | – |
| 2C | 2–3 weeks | – |
| 2D | 2 weeks | 10–15 hours |
| 2E | 2 weeks | **40–80 hours** ← the real cost |
| 2F | 1–2 weeks | – |

Engineering is roughly 11–15 weeks. Content review dominates and is the schedule risk. Estimates are provisional and should be replaced with measured rates after 2A.

## The decision point after 2A

2A produces the first real data on the three assumptions this phase rests on:

1. **Extraction quality** — precision and recall against the golden set.
2. **Review throughput** — actual statements per hour.
3. **Whether grounding helps** — grounded versus ungrounded lesson quality.

If (1) is poor, invest in multi-pass extraction before scaling content.
If (2) is below ~150/hour, the tooling needs work before scaling content.
**If (3) shows no improvement, stop and reconsider the phase.** That is not a failure; it is the plan working — a platform that cannot be falsified is not engineering.

---

*End of Part X. Appendices follow.*
