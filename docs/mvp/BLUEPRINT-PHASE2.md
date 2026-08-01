# Agabi — Phase 2 Blueprint (Teaching Pipeline)

Grounded, verified, adaptive teaching, built as measurable engines behind `SOURCE_GROUNDING`
(off by default = today's behaviour; one-flip rollback per CLAUDE.md §I). This is the committed
form of the approved plan; the **As built** map at the end ties each engine to its real file.

## Governing laws
- **L1 Measurability** — not measured = not engineered; every requirement → ground truth → prediction → metric → stored eval.
- **L2 Problem-transformation** — never solve a subjective problem; turn it into measurable conditions + a release rule.
- **L3 Measure the decision, not the prediction** — evaluate the observable behaviour a prediction causes (routing, wrong-teaching), not the model's internal label.
- **L4 One vertical slice** — Phase 2 owns the Teaching Pipeline end-to-end; it emits events, never interprets them; no learner-state.
- **L5 Single source of truth** — every state/metric has exactly one owner engine; many read, one writes.

## Goal (measurable finish line)
Given a student message, Agabi: (a) routes to the correct capability with **Wrong-Teaching-Rate = 0 &
Unsafe-Routing = 0** on the benchmark; (b) for an in-corpus topic produces a **problem-first grounded**
lesson; (c) **verifies every factual claim** (groundedness ≥ threshold, 0 contradicted delivered); (d)
**measures its own quality** (completeness, readability, diversity); (e) safely delivers — behind a flag.

## Non-goals
No embeddings/vector (Postgres full-text first); no web fallback (Phase 3); no knowledge-graph writes on
the teaching path (A-7); no Observation/Student-Model/Mastery/Memory build (Phase 4+ — seam only); no
onboarding UI (param seam only); no store-schema change; no frontend redesign.

## Dependencies (one direction; no cycles)
```
Intent → Capability Router → Grounding → Teaching(Fill) → Evidence Verification → Evaluation → Events
```
Reuses Phase-1: `KnowledgeStore.searchChunks/getSource`, `teachingStyle()`, `repairOutline`/`buildSkeleton`/
`coerceSlot`/`adaptBlock`/`fillChunk` (unchanged).

## Ownership registry (L5 — one owner each)
| State / Metric | Owner | Writers |
|---|---|---|
| Intent Object | Intent Engine (`understand.ts`) | one |
| Capability decision | Capability Router (`router.ts`) | one |
| Grounded outline | Grounding Engine (`grounding.ts`) | one |
| Lesson / slot state | Teaching (Fill) — `manager.ts` | one |
| Claim labels + groundedness | Evidence Verification (`evidence.ts`) | one |
| All KPIs + benchmark verdict | Evaluation Engine (`evaluation/**`) | one |
| SourceChunk / Source (corpus) | KnowledgeStore (frozen) | one |

## State-transition invariants (what can NEVER happen)
- An unverified / contradicted lesson block never stands as READY.
- **Wrong-Teaching-Rate stays 0** — no lesson for a non-topic / off-syllabus / small-talk message.
- Grounding / Verification / Evaluation never write canonical-knowledge rows (A-7).
- No engine overwrites another engine's owned state (L5). No cycle in the graph above.

## Problem-transformation (no subjective word survives — L2)
"smart / understands" → Routing + Unsafe(0) + Unknown-detection · "don't hallucinate" → Groundedness +
0-contradicted · "good / clear" → Teaching-Completeness + Readability band · "explain differently" →
Diversity = 1 − similarity(prev, current) · "from the book" → Groundedness + problem-first.

## Definition of Done (objective gate)
GitHub gates green: verify · semgrep · smoke · e2e · mutation, plus the benchmark regression test
(inside verify) asserting Wrong-Teaching = 0 · Unsafe-Routing = 0 · Unknown-Detection ≥ target ·
off-syllabus refusal ≥ target. Coverage ≥ 90 + mutation ≥ 90. Flag off ⇒ byte-identical to today.
(`sonarqube` needs `SONAR_TOKEN` — an environment gate owned by the repo, not this code.)

## As built (each engine → its file)
| Step | Engine | Files |
|---|---|---|
| 1 | Evaluation + benchmark | `evaluation/metrics.ts`, `evaluate.ts`, `readability.ts`, `completeness.ts`, `diversity.ts`, `benchmark/{dataset,load}.ts` |
| 2 | Evidence Verification | `conversation/evidence.ts`, `conversation/verifyBlock.ts` |
| 3 | Grounding (problem-first, A-7) | `conversation/grounding.ts` |
| 4 | Intent Object + Capability Router | `conversation/understand.ts`, `conversation/router.ts` |
| 5 | Wiring + events | `conversation/manager.ts` (flag-gated), `events.ts` + `evidence/taxonomy.ts` (`capability.selected` / `claims.verified` / `lesson.generated`) |
| 6 | Adaptivity (diversity) | `conversation/adaptivity.ts` |
| 7 | Onboarding seam | `contract/schemas.ts` (`teachingPrefs`), `conversation/prompt.ts` (`teachingStyle(prefs?)`) |
| 8 | CI regression gate | `evaluation/benchmark/regression.test.ts` (runs inside the CI test step) |
| — | Rollout flag | `conversation/flags.ts` (`SOURCE_GROUNDING`, off by default) |

Rollback: `SOURCE_GROUNDING=0` (the default) is byte-identical to Phase 1. Turn on gradually (§I).
