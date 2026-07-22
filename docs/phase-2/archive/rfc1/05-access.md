# Part V — Access: Search, Retrieval, APIs, Query, Traversal

---

# 25. Search Architecture

## 25.1 Search resolves concepts, never documents 🔒

The output of search is `ConceptRef[]`. Not pages, not chunks, not statements. Everything resolves back to entities, because entities are what teaching, mastery, and recommendation all operate on.

A search that returns documents forces every consumer to re-resolve them, and every consumer will do it differently.

## 25.2 The four-rung ladder ⚖️

Deliberately mirrors the fill ladder already in `advisors/chunk.ts` — cheap and deterministic first, expensive and probabilistic last.

| Rung | Method | Deterministic | Cost | Ships |
|---|---|:-:|---|:-:|
| 1 | exact slug match | yes | index lookup | v1 |
| 2 | alias match (incl. translations, misspellings) | yes | index lookup | v1 |
| 3 | trigram similarity (`pg_trgm`) over name + aliases + statement text | yes | GIN index | v1 |
| 4 | vector similarity (pgvector) | no | ANN index | 2D+ |

Each rung runs only if the previous returned nothing above a confidence floor. Rungs 1–3 need **no new dependency** — `pg_trgm` is a Postgres extension, not an npm package.

**Why deterministic first:** for a syllabus term like "photosynthesis", exact and alias matching is *better* than semantic search, not merely cheaper — it cannot drift, it is explainable, and it is reproducible in a replay. Semantic search earns its place only where lexical resolution demonstrably fails, and `knowledge.miss` events will say exactly when that is.

## 25.3 Query interface

```ts
export interface SearchQuery {
  text?: string;
  kinds?: string[];              // FACT, SKILL…
  tags?: { namespace: string; value: string }[];
  program?: ProgramNodeId;       // "within CBSE Class 10 Science"
  context?: Context;             // affects which statements are searched
  relatedTo?: ConceptId;         // relationship search
  requires?: ConceptId;          // dependency search — "what needs this?"
  scope?: string;
  limit?: number;
}

export interface SearchHit {
  conceptId: ConceptId;
  score: number;
  rung: 1 | 2 | 3 | 4;           // which rung matched — explainability
  matchedOn: "slug" | "alias" | "name" | "statement" | "vector";
}
```

`rung` and `matchedOn` are returned so a result is always explainable. A search system that cannot say *why* it matched cannot be debugged and cannot be trusted in a teaching path.

## 25.4 Search-type coverage

| Requested | Mechanism |
|---|---|
| Concept search | rungs 1–4 |
| Skill search | `kinds: ["SKILL"]` |
| Objective search | `LearningObjective` full-text → `ObjectiveConcept` → concepts |
| Tag search | `ConceptTag` index |
| Relationship search | `relatedTo` → `edgesFrom/edgesTo` |
| Dependency search | `requires` → reverse `REQUIRES` traversal |
| Subject search | tag `subject:*` |
| Topic search | tag `topic:*` or `ProgramNode` subtree |
| Semantic | rung 4, deferred |

All nine resolve to `ConceptRef[]`, per §25.1.

---

# 26. Retrieval Architecture

## 26.1 Retrieval ≠ search

**Search** answers *"which concepts match this query?"* — a ranking problem.
**Retrieval** answers *"what content should be assembled for this teaching act?"* — a selection problem, with prerequisites, budget, and learner state.

Separated because they have different consumers, different determinism requirements, and different failure modes. Search may return nothing and that is fine. Retrieval returning nothing triggers fallback.

## 26.2 `selectPath` — the teaching bridge 🔒

```ts
export function selectPath(
  seeds: ConceptId[],
  learner: LearnerContext,     // Phase 2: context only. Phase 3: + mastery.
  objective: Objective,        // LEARN | REVISE | DEEPEN | EXAM_PREP
  budget: PathBudget,          // { maxConcepts, maxSlots }
): Promise<OrderedConcept[]>;
```

**Deterministic. No model call. Pure given the graph.**

Algorithm:

1. **Expand** — prerequisite closure over `REQUIRES`, bounded depth, preferring context-matching edges (§20.4).
2. **Prune** — drop concepts the learner has mastered. *Phase 2: no-op, no mastery data.*
3. **Sort** — topological order over `REQUIRES`. Cycle → throw, never guess. Ties broken by `Mapping.ordinal` when a program is in play, else by concept creation order for stability.
4. **Band** — `PREREQUISITE | CORE | DEPTH | APPLICATION`, derived from distance from the seeds and `Mapping.depth`.
5. **Budget** — truncate to fit one lesson, never mid-band, always keeping all `PREREQUISITE` and at least one `CORE`.
6. **Resolve statements** — for each concept, `statementsFor(concept, context)` → the single most specific statement (§16.5).

Output feeds `outlineFrom()`, which produces `OutlineSlot[]` in the shape `repairOutline` already expects.

## 26.3 The integration, exactly

```ts
// manager.ts — startLesson(), the ONE call site that changes
async function startLesson(ctx: RunCtx, topicRaw: string): Promise<void> {
  const topic = topicRaw.trim() || "this idea";
  ctx.write({ t: "status", status: "planning" });

  const hits  = await search.resolve({ text: topic, context: ctx.learnerContext });
  const path  = hits.length
    ? await selectPath(hits.map(h => h.conceptId), ctx.learner, "LEARN", DEFAULT_BUDGET)
    : [];

  // Grounded when the graph can serve it; today's behaviour when it cannot.
  const proposed = path.length ? outlineFrom(path, topic) : defaultOutline(topic);
  const { outline } = repairOutline(proposed, topic);

  if (!path.length) {
    void emit(ctx.userId, EVENTS.knowledgeMiss, { topic }, "server", ctx.sessionId);
  }
  // …unchanged from here: createLesson, transitions, teachChunk, advanceCursor
}
```

Everything downstream — `repairOutline`, `buildSkeleton`, `coerceSlot`, `adaptBlock`, `fillChunk`, every renderer, the visual guarantee, skeleton-first rendering — is untouched. `repairOutline` still enforces the heading/summary bookends, the three-visual floor, and the max-text-run rule, on grounded outlines exactly as on templated ones.

## 26.4 The grounded prompt ⚖️

The prompt's role inverts. Today it says *teach photosynthesis*. Grounded, it says *render these statements*:

```
You are rendering a lesson from VERIFIED knowledge. Do not add facts.
Do not correct, extend, or contradict the statements given.
If a statement seems wrong, render it as given — corrections are a human process.

Slot 3 — type: flow
  Statement: "Photosynthesis converts light energy into chemical energy."
  Concepts: Photosynthesis, Light energy, Chemical energy
```

The model's remaining freedom is *presentation*: wording for a 14–16 year old, choosing the diagram's layout, structuring the table. Its freedom to *assert* is removed.

## 26.5 Measuring whether it helped

Every lesson records `grounded: boolean`, the concept ids and versions used, and the graph release. Combined with the existing quality outcome (`COMPLETE | PARTIAL | FAILED`) and per-slot rung data, grounded and ungrounded lessons are directly comparable.

This is the falsification test for the entire phase (§4.7). If grounded lessons are not measurably better, that is a finding that should change the plan.

---

# 32. API Architecture

## 32.1 Internal modules first ⚖️

**ADR-7 — No public HTTP knowledge API in Phase 2**

*Decision.* The knowledge platform exposes TypeScript modules. The only new HTTP routes are those the review UI needs.

*Rationale.* An API with no consumer cannot be designed correctly — you guess at pagination, filtering, and error shapes, then live with the guesses. The review UI is the first real consumer and will drive the design. `contract/endpoints.ts` already establishes the pattern for adding routes when needed.

*Consequences.* External integrations wait. Acceptable: there are none.

## 32.2 The internal surface

```ts
// knowledge/index.ts — the entire public surface of the platform
export const knowledge = {
  resolve,            // (SearchQuery) → SearchHit[]
  getConcept,         // (id|slug, at?) → Concept | null
  getTeachable,       // (ids, ctx) → Concept[]     VERIFIED only, always
  statementsFor,      // (ids, ctx, at?) → Statement[]
  prerequisitesOf,    // (id, depth) → OrderedConcept[]
  dependentsOf,       // (id) → ConceptRef[]
  curriculumFor,      // (id) → Mapping[]
  conceptsUnder,      // (programNodeId) → Mapping[]
  selectPath,         // the teaching bridge
  itemsFor,           // (conceptIds, ctx) → AssessmentItem[]
};
```

`getTeachable` is the **only** function the Teaching Engine may call to obtain content, and it filters `status = VERIFIED` unconditionally. There is no parameter to disable that filter. A `PROPOSED` concept cannot reach a student because there is no API through which it could.

## 32.3 Review routes (Phase 2C)

| Route | Purpose |
|---|---|
| `GET /api/knowledge/review/queue` | prioritised batches |
| `GET /api/knowledge/review/batch/{chunkId}` | proposals + source text + highlight ranges |
| `POST /api/knowledge/review/decide` | apply decisions atomically |
| `GET /api/knowledge/merge/queue` | duplicate candidates side by side |
| `POST /api/knowledge/merge` | execute a merge with tombstone |

All authenticated, all reviewer-role gated (§40), all writing `ReviewEvent`.

---

# 33. Query Model

## 33.1 Access patterns — the design driver

Storage decisions follow from these, not the reverse (§30).

| # | Pattern | Frequency | Shape | Latency budget |
|---|---|---|---|---|
| A1 | resolve text → concepts | every lesson | index lookup | < 20 ms |
| A2 | prerequisite closure | every lesson | recursive, depth ≤ 6 | < 50 ms |
| A3 | statements for N concepts in a context | every lesson | join + filter + rank | < 30 ms |
| A4 | concepts under a program node | browse | subtree | < 50 ms |
| A5 | programs teaching a concept | rare | reverse index | < 50 ms |
| A6 | dependents of a concept | review ordering | reverse edges | < 50 ms |
| A7 | version history | audit | chain walk | < 200 ms |
| A8 | contradiction detection | scheduled | self-join | minutes ok |
| A9 | duplicate detection | scheduled | similarity | minutes ok |
| A10 | review queue | review session | filter + order | < 100 ms |
| A11 | whole-graph cycle check | CI + scheduled | full DFS | minutes ok |
| A12 | assessment items for concepts | Phase 3 | join | < 30 ms |

**Observations that decide §30:**
- The hot path is A1–A3, all cacheable, none deeper than 6 hops.
- Genuinely graph-shaped queries (A2, A6, A11) are shallow or offline.
- No pattern requires unbounded-depth traversal or path-finding between arbitrary nodes.

This is emphatically **not** a social-graph workload.

## 33.2 Point-in-time queries

Every read accepts an optional `at?: ReleaseId`. Absent means current. Present means "as the graph stood at that release" — resolved by filtering to the release's pinned version ids (§27.4).

This is what makes G6 (reconstructable lessons) achievable: a 2029 replay of a 2026 lesson passes the 2026 release id and gets exactly the statements the student saw.

---

# 34. Traversal Engine

## 34.1 Bounded by construction

```ts
export interface TraversalSpec {
  seeds: ConceptId[];
  edgeTypes: EdgeType[];
  direction: "forward" | "reverse";
  maxDepth: number;        // REQUIRED. no unbounded traversal, ever.
  maxNodes: number;        // REQUIRED. hard stop.
  context?: Context;       // prefer context-matching edges (§20.4)
  at?: ReleaseId;
}
```

`maxDepth` and `maxNodes` are **mandatory**, with no defaults that mean infinity. An unbounded traversal over a graph that has accidentally acquired a cycle is a production hang; requiring the bound makes that impossible to write by accident.

Truncation is reported (`truncated: true`) rather than silent, per the general rule that a cap the caller does not know about is indistinguishable from complete coverage.

## 34.2 Postgres implementation

```sql
WITH RECURSIVE closure(id, depth, path) AS (
  SELECT unnest($1::text[]), 0, ARRAY[]::text[]
  UNION ALL
  SELECT e."fromId", c.depth + 1, c.path || e."toId"
  FROM closure c
  JOIN "Edge" e ON e."toId" = c.id
  WHERE e.type = ANY($2)
    AND c.depth < $3
    AND NOT e."fromId" = ANY(c.path)     -- cycle guard, belt and braces
)
SELECT DISTINCT id, MIN(depth) AS depth FROM closure GROUP BY id LIMIT $4;
```

The `NOT ... = ANY(c.path)` guard means that even if a cycle somehow exists despite §20.2's three defences, traversal terminates rather than hanging.

## 34.3 Topological sort

Kahn's algorithm over the closure subgraph, with **deterministic tie-breaking** — `Mapping.ordinal` when a program is in play, otherwise concept id. Same graph and same seeds always produce the same order, which is required for `selectPath` to be replayable (§10.3).

---

*End of Part V. Part VI — Identity, Time and Truth (§27–29, 38) follows.*
