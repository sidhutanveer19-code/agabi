# RFC-2 · Part V — Content Engineering, Validation, Search, API

*RFC-1's versions of these sections assumed a binary verification gate and SPO-shaped statements. Both assumptions died. These are rewritten, not copied.*

---

# 31. Component Architecture

## 31.1 Module layout

```
src/server/
  knowledge/                    ← PLATFORM. pure + store. never imports advisors/
    concept.ts                  entities, aliases, tags, SPLIT
    proposition.ts              assertions; SPO is one index among several
    context/
      registry.ts               OPEN dimension registry (§18)
      match.ts                  specificity lattice, compatibility
    graph/
      dependency.ts             REQUIRES only. DAG. topological sort.
      reinforcement.ts          everything else. cycles legal.
      traverse.ts               bounded closure, shared by both
    trust/
      ladder.ts                 six levels, promotion + demotion
      validators/               deterministic. quote, payload, units, dates, refs
      corroboration.ts          independent-source agreement
      contradiction.ts          conflict detection against verified knowledge
      inference.ts              entailment; derived statements carry derivation
      policy.ts                 TrustPolicy per consumer
    teaching/
      asset.ts                  TeachingAsset
      registry.ts               asset kinds
      select.ts                 assetsFor() — ranked by efficacy
    curriculum.ts               Learning Programs + mappings
    search.ts                   resolve() — four rungs
    version.ts                  chains, releases, tombstones, split markers
    review.ts                   ReviewEvent, reputation capture
    path.ts                     selectPath() — the teaching bridge
    ids.ts
    store/
      KnowledgeStore.ts         THE interface
      postgres.ts
      conformance.test.ts

  observation/                  ← SEPARATE STORE. never joined to knowledge.
    record.ts                   append-only
    mastery.ts                  mastery as a QUERY
    efficacy.ts                 asset outcomes
    earn.ts                     derive REINFORCES edges from measured transfer

  ingest/                       ← CONTENT. pure. no models, no store.
    parse/  clean.ts  normalise.ts  chunk.ts  pipeline.ts

  advisors/knowledge/           ← UNTRUSTED. the only models in Phase 2.
    extractConcepts.ts  extractPropositions.ts  extractAssets.ts

  review/                       ← workflow. store + knowledge. no models.
    queue.ts  batch.ts  decide.ts  merge.ts  split.ts
```

## 31.2 Wall rules — extending `architecture.test.ts`

| Rule | Rationale |
|---|---|
| only `advisors/**` may import an AI SDK | existing Phase 1 wall, unchanged |
| `knowledge/**` may not import `advisors/**` | knowledge cannot depend on proposal |
| `ingest/**` may not import the store | the pipeline proposes; it never writes |
| `observation/**` may not import `knowledge/store` | store separation (§25.3) |
| nothing outside `store/**` imports Prisma | engine independence |
| `knowledge/graph/dependency.ts` may not import `reinforcement.ts` | the DAG check must never see cyclic edges |

The last rule is what stops the two graphs collapsing back into one over time.

---

# 32. Content Engineering — the pipeline

## 32.1 Stages

```
fetch → parse → clean → normalise → chunk → EXTRACT → validate
      → resolve → corroborate → contradict → PROMOTE → review
```

| Stage | Pure | Model | Output | Trust effect |
|---|:-:|:-:|---|---|
| fetch | no | no | `Source` + bytes | – |
| parse | **yes** | no | spans with locators | – |
| clean | **yes** | no | spans, offsets preserved | – |
| normalise | **yes** | no | canonical text | – |
| chunk | **yes** | no | content-addressed chunks | – |
| extract | no | **yes** | `Advice<RawProposal[]>` | `MACHINE_PROPOSED` |
| validate | **yes** | no | proposals or rejections | → `AUTO_VALIDATED` |
| resolve | **yes** | no | names → concept ids | – |
| corroborate | **yes** | no | independent-source counts | supports promotion |
| contradict | **yes** | no | conflicts against verified | **blocks promotion** |
| review | no | no | `ReviewEvent` | → `COMMUNITY`/`EXPERT`/`OFFICIAL` |

**The change from RFC-1:** the pipeline no longer terminates at a human. It terminates at a **trust level**, and a statement may legitimately stop at `AUTO_VALIDATED` and still be teachable to a consumer whose policy accepts that floor. Human review promotes; it is no longer the only thing that admits.

## 32.2 Span-preserving cleaning 🔒

```ts
interface Span { text: string; sourceRange: [number, number]; page: number; }
type Doc = Span[];
```

Removing a header drops a span and leaves the others' ranges intact. A quote's character range therefore maps back to the original page after every transformation — which is what lets review highlight it in the real passage, and what makes grounding checkable.

Doing this on plain strings destroys the mapping irrecoverably.

## 32.3 Chunking

`chunkId = sha256(sourceId + JSON(locator) + normalisedText)`

Content-addressed. A re-ingested unchanged chapter produces identical ids and no work. A chapter with one edited paragraph produces one new id. **Re-ingestion is a diff**, which is what makes new editions cheap (§34.4).

## 32.4 Extraction — three passes ⚖️

RFC-1 proposed one pass and marked it provisional. RFC-2 splits it, because entity resolution must happen *before* propositions are formed or duplicates are created at proposal time.

| Pass | In | Out |
|---|---|---|
| 1 · entities | chunk | concept candidates, resolved against existing graph + aliases |
| 2 · propositions | chunk + resolved entities | assertions linking known entities |
| 3 · dependencies | chunk + entities | `REQUIRES` candidates and reinforcement candidates, **separated** |

Pass 3 must classify each dependency as prerequisite or reinforcement. That classification is the single most error-prone judgment in extraction — it is what keeps the DAG honest — so it is always surfaced for human confirmation regardless of trust level.

A fourth pass extracts teaching assets (§21) and runs only over chapters whose knowledge is already verified.

## 32.5 Halt conditions

| Condition | Action |
|---|---|
| >50% of a batch fails validation | halt the source; bad prompt or mis-parsed document |
| >30% tier-3 duplicate hits | halt; the source is probably already ingested |
| contradiction rate above baseline | halt; the source may conflict with established knowledge |

The expensive failure is not a rejected proposal. It is thousands of subtly wrong proposals consuming review capacity.

---

# 33. Validation Architecture

## 33.1 Gates, in order

| # | Gate | Check | Failure |
|---|---|---|---|
| V1 | schema | `accept(advice, schema)` | discard batch |
| V2 | payload | registry schema for kind | discard |
| V3 | **grounding** | normalised quote is literally contained in the chunk | **discard** |
| V4 | quote length | 10 ≤ n ≤ 500 | discard |
| V5 | originality | `text` is not a substring of `quote` | **flag — copyright** |
| V6 | entity resolution | names resolve or are flagged new | flag |
| V7 | **acyclicity** | proposed `REQUIRES` does not close a cycle | **reject edge, show cycle** |
| V8 | edge classification | prerequisite vs reinforcement stated | flag for human |
| V9 | context validity | dimensions registered; `validFrom < validUntil` | discard |
| V10 | units and dimensions | numeric claims dimensionally consistent | flag |
| V11 | date coherence | dates plausible and ordered | flag |
| V12 | self-reference | subject ≠ object | discard |
| V13 | scope | tenant proposals cannot reference other tenants | discard + security alert |
| V14 | **analogy breakdown** | every `ANALOGY` asset states where it fails | **discard** |

Passing every applicable gate is exactly what `AUTO_VALIDATED` means. It is a defined epistemic state, not a waiting room.

## 33.2 V3 — grounding

```ts
const n = (s: string) => s.normalize("NFC")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/\s+/g, " ").trim().toLowerCase();

if (!n(chunk.text).includes(n(quote))) reject("QUOTE_NOT_IN_SOURCE");
```

Deliberately **not fuzzy.** A model paraphrasing while claiming to quote is doing precisely what this gate exists to catch. It also returns the character range, which is what makes highlighted review possible.

## 33.3 Contradiction as a validator 🔒

The gate that makes trust scale sublinearly.

```
new proposition P, context C
  → find verified propositions with overlapping context and conflicting content
  → conflict found → P cannot promote above AUTO_VALIDATED
                   → the conflict is recorded and queued
                   → if the existing statement is at OFFICIAL or above, P is
                     surfaced to review as a challenge, not as a candidate
```

**The graph defends itself, and gets better at it as it grows.** Human effort per statement *decreases* with graph size. This is the only mechanism in the architecture that makes 100M concepts arithmetically conceivable.

---

# 34. Search Architecture

## 34.1 Search resolves concepts 🔒

Output is `ConceptRef[]`. Never documents, never chunks, never raw propositions. Every consumer operates on entities, and a search that returns documents forces each consumer to re-resolve them differently.

## 34.2 Four rungs

| Rung | Method | Deterministic | Ships |
|---|---|:-:|:-:|
| 1 | exact slug | yes | 2A |
| 2 | alias, including translations and former names | yes | 2A |
| 3 | trigram similarity over name, aliases, proposition text | yes | 2D |
| 4 | vector similarity | no | when rung 3 measurably fails |

Rungs 1–3 need no new dependency — `pg_trgm` is a Postgres extension.

For a syllabus term, exact matching is *better* than semantic search, not merely cheaper: it cannot drift, it is explainable, and it is reproducible in a replay.

## 34.3 Trust-aware results 🔒

```ts
interface SearchQuery {
  text?: string;
  kinds?: string[];
  tags?: { namespace: string; value: string }[];
  program?: ProgramNodeId;
  context?: Context;
  relatedTo?: ConceptId;          // reinforcement graph
  requires?: ConceptId;           // dependency graph, reverse
  trustPolicy: TrustPolicy;       // ← REQUIRED. no default.
  scope?: string;
}

interface SearchHit {
  conceptId: ConceptId;
  score: number;
  rung: 1 | 2 | 3 | 4;
  matchedOn: "slug" | "alias" | "proposition" | "vector";
  trustLevel: TrustLevel;         // ← always returned
}
```

`trustPolicy` has **no default**. A caller must state what it will accept, which makes it impossible to accidentally surface `MACHINE_PROPOSED` knowledge to a student. `rung` and `matchedOn` make every result explainable.

## 34.4 Coverage

Concept, skill, objective, tag, relationship (reinforcement graph), dependency (DAG reverse), subject and topic (tags or program subtree), and future semantic — all resolve to `ConceptRef[]`.

---

# 35. API Architecture

## 35.1 Internal modules first ⚖️

No public HTTP knowledge API in Phase 2. An API with no consumer cannot be designed correctly; you guess at pagination, filtering and error shapes and then live with the guesses. The review UI is the first real consumer and drives the route design.

## 35.2 The surface

```ts
export const knowledge = {
  // resolution
  resolve(q: SearchQuery): SearchHit[];
  getConcept(idOrSlug, at?: ReleaseId): Concept | null;

  // assertions — trust policy is REQUIRED on every read
  propositionsFor(ids: ConceptId[], ctx: Context, policy: TrustPolicy, at?): Proposition[];

  // the two graphs, explicitly named — never a generic "getEdges"
  prerequisitesOf(id, depth): OrderedConcept[];     // DAG
  dependentsOf(id): ConceptRef[];                   // DAG reverse
  reinforcementsOf(id, types): ConceptRef[];        // cyclic graph

  // teaching
  assetsFor(concepts, ctx, policy): TeachingAsset[];   // ranked by efficacy

  // curriculum
  curriculumFor(id): Mapping[];
  conceptsUnder(programNodeId): Mapping[];

  // the bridge
  selectPath(seeds, learner, objective, policy, budget): LessonPlan;
};

export const observation = {          // SEPARATE STORE
  record(o: NewObservation): void;
  mastery(learnerId, conceptId, atBloom?, asOf?): MasteryEstimate;   // a QUERY
  efficacy(assetId, ctx): EfficacyEstimate;
};
```

**Two deliberate design choices.**

`prerequisitesOf` and `reinforcementsOf` are separate functions rather than one `getEdges(type)`. Naming them apart makes it impossible to accidentally run a topological sort over cyclic edges.

`TrustPolicy` is a required parameter on every content-returning call. There is no way to read knowledge without stating what trust you require.

## 35.3 Review routes (2C)

`GET /review/queue` · `GET /review/batch/{chunkId}` · `POST /review/decide` · `GET /merge/queue` · `POST /merge` · `POST /split`. All authenticated, role-gated, all writing `ReviewEvent`.

---

# 36. Indexing Strategy

| Table | Index | Serves |
|---|---|---|
| Concept | `(status, kind)` | teachable filter |
| Concept | `(slug)` unique | rung 1 |
| ConceptAlias | `(alias)` + GIN trigram | rungs 2–3 |
| ConceptTag | `(namespace, value)` | tag search |
| Proposition | `(subjectId, trustLevel)` | trust-filtered reads |
| Proposition | `(contextId)` | context matching |
| Proposition | GIN trigram on `text` | rung 3 |
| DependencyEdge | `(fromId)` PK, `(toId)` | DAG both directions |
| ReinforcementEdge | `(fromId, type)`, `(toId, type)` | reinforcement traversal |
| TeachingAsset | `(conceptId, kind, trustLevel)` | asset selection |
| Mapping | `(conceptId)` | "which programs teach this?" |
| Observation | `(learnerId, occurredAt)` | separate store, time-partitioned |
| Observation | GIN on `conceptIds` | mastery queries |

**Partial indexes** keep the hot set small, since most reads touch only high-trust current rows:

```sql
CREATE INDEX prop_teachable ON "Proposition" ("subjectId","contextId")
  WHERE "trustLevel" IN ('OFFICIAL_SOURCE_VERIFIED','AGABI_CANONICAL','EXPERT_REVIEWED');
```

**Closure cache** removes DAG traversal from the hot path entirely: `(conceptId, releaseId) → ordered prerequisite list`, invalidated on any dependency-edge write. v1 invalidation clears the whole cache on review commit — crude, correct, cheap. Subgraph-precise invalidation is 🔬 and waits for observed write patterns.

---

*Part VI covers versioning, migration, risk, premortem and the consolidated data model.*
