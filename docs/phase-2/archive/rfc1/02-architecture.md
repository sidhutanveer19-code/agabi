# Part II — Architecture

---

# 8. Overall Backend Architecture

## 8.1 The existing system, accurately

Phase 2 is an addition to a working system. Misrepresenting what exists is the fastest way to design something that will not integrate. This section is the ground truth, read from the committed code.

```
                        ┌──────────────────────────────────────┐
   POST /api/canvas/    │  route  (src/app/api/canvas/…/teach) │
   {canvasId}/teach ───▶│  auth · rate-limit · NDJSON stream   │
                        └───────────────────┬──────────────────┘
                                            ▼
                        ┌──────────────────────────────────────┐
                        │  conversation/manager.ts   run()     │
                        │  DETERMINISTIC. Owns every decision. │
                        └───┬──────────────┬───────────────┬───┘
              ┌─────────────┘              │               └──────────────┐
              ▼                            ▼                              ▼
   ┌────────────────────┐    ┌──────────────────────────┐   ┌────────────────────┐
   │ advisors/          │    │ conversation/            │   │ evaluation/        │
   │ UNTRUSTED          │    │ TRUSTED                  │   │ OFFLINE            │
   │ may call models    │    │ owns state               │   │ imported by        │
   │ returns Advice<T>  │    │ never calls a model      │   │ NOTHING in prod    │
   │                    │    │                          │   │                    │
   │ intent.ts          │    │ actions.ts   outline.ts  │   │ shadowPlanner.ts   │
   │ chunk.ts           │    │ lessonState.ts skeleton  │   │                    │
   │ jsonFill.ts        │    │ coerce.ts  validateBlock │   │                    │
   │ providers.ts       │    │ lessonRepo.ts context.ts │   │                    │
   └────────────────────┘    └──────────────┬───────────┘   └────────────────────┘
                                            ▼
                              ┌──────────────────────────┐
                              │ Postgres (Prisma)        │
                              │ Workspace Lesson Session │
                              │ Event  RateHit  Consent  │
                              └──────────────────────────┘
```

**The three walls, as enforced by `src/server/architecture.test.ts`:**

1. Only files under `advisors/` may import an AI SDK (`ai`, `@ai-sdk/*`). **No `import type` exemption** — a type import across the wall is still a breach.
2. `advisors/` may not import the database.
3. `evaluation/` is imported by nothing in production.

The test walks `src/server` with `readdirSync`, extracts every import specifier by regex, and asserts these properties file by file. It is grep-based, crude, and completely effective: an advisor that *cannot* import Prisma cannot write to the database, regardless of intent.

**The trust boundary, as enforced by the type system** (`advisors/advice.ts`):

```ts
export type Advice<T> = { readonly __brand: "advice"; readonly raw: unknown };
export function advise<T>(raw: unknown): Advice<T>;
export function accept<T>(a: Advice<T>, schema: z.ZodType<T>): T | null;
```

`Advice<T>` carries `unknown`. The only exit is `accept()`, which validates and returns `null` on any failure. Every state mutator in `lessonRepo.ts` takes plain values. Passing raw model output to `createLesson()` is a **compile error**, not a code review finding.

**This is the single most important existing asset for Phase 2**, because knowledge extraction is exactly the same problem shape as intent classification: an untrusted model proposing something that deterministic code must validate before it counts.

## 8.2 Where Phase 2 attaches

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                    CONTENT ENGINEERING                          │
   │                                                                 │
   │  Source → parse → clean → normalise → chunk ──┐                 │
   │  (pure, deterministic, no models, no DB)      │                 │
   │                                               ▼                 │
   │                            ┌──────────────────────────┐         │
   │                            │ advisors/knowledge/      │         │
   │                            │ extract.ts  UNTRUSTED    │         │
   │                            │ → Advice<RawProposal[]>  │         │
   │                            └──────────┬───────────────┘         │
   │                                       ▼                         │
   │      validate → dedupe → propose → HUMAN REVIEW ──────┐         │
   │      (deterministic)                                  │         │
   └───────────────────────────────────────────────────────┼─────────┘
                                                           ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                   PLATFORM ENGINEERING                          │
   │                     knowledge/                                  │
   │                                                                 │
   │   Concept · Statement · Context · Relationship · Assessment     │
   │   Curriculum mapping · Source · Provenance · Version · Release  │
   │   Search · Traversal · Path selection                           │
   │                                                                 │
   │   NEVER imports advisors/.  NEVER calls a model.                │
   └───────────────────────────┬─────────────────────────────────────┘
                               │  selectPath() / getTeachable()
                               ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │       EXISTING TEACHING ENGINE — one call site changes          │
   │       manager.ts  startLesson()                                 │
   └─────────────────────────────────────────────────────────────────┘
```

## 8.3 Module layout

```
src/server/
  knowledge/                    ← PLATFORM. pure + store. no models, ever.
    concept.ts                  entity type, zod
    statement.ts                assertion type, SPO, zod
    context.ts                  the context tuple + matching/specificity
    objectTypes/                the extensible type registry
      registry.ts               kind → { schema, validators, capabilities }
      fact.ts  procedure.ts  skill.ts  assessment.ts   (v1 kinds)
    relationship.ts             edge types, DAG rules
    graph.ts                    traversal, closure, cycle detection
    version.ts                  version chains, releases, tombstones
    review.ts                   status machine, ReviewEvent
    search.ts                   resolve(): exact → alias → trigram → (vector)
    curriculum.ts               Learning Program graph + mappings
    path.ts                     selectPath() — the teaching bridge
    ids.ts                      id minting, slug rules, resolution
    store/
      KnowledgeStore.ts         THE interface. all access goes here.
      postgres.ts               v1 implementation
      conformance.test.ts       any implementation must pass this

  ingest/                       ← CONTENT. pure. no models, no store.
    parse/  pdf.ts html.ts markdown.ts json.ts
    clean.ts  normalise.ts  chunk.ts
    pipeline.ts                 stage orchestration, deterministic

  advisors/knowledge/           ← UNTRUSTED. the only model in Phase 2.
    extract.ts                  chunk → Advice<RawProposal[]>
    prompts.ts                  PROMPT_VERSION lives here
    schemas.ts                  zod for accept()

  review/                       ← workflow. store + knowledge. no models.
    queue.ts  batch.ts  decide.ts  merge.ts
```

**ADR-1 — `knowledge/` is a peer of `conversation/`, not a child**

*Context.* `knowledge/` could live inside `conversation/` since teaching is its first consumer.

*Decision.* Peer directory, imported by `conversation/`.

*Alternatives.* (a) Inside `conversation/` — rejected: implies teaching owns knowledge, and the Mastery, Memory and Recommendation engines will all consume it without going through teaching. (b) A separate package — rejected: premature, no second consumer process exists.

*Consequences.* `architecture.test.ts` gains rules: `knowledge/` and `ingest/` may not import an AI SDK; `knowledge/` may not import `advisors/`; `ingest/` may not import the store. Import direction is `conversation/ → knowledge/`, never the reverse — teaching may read knowledge; knowledge knows nothing about lessons.

## 8.4 Relationship to the Evidence Spine

Phase-2-Observability (in flight) establishes an append-only evidence log with tiered durability, provenance, causality, and replay. Phase 2 Knowledge **consumes and extends** it rather than duplicating it:

| Concern | Owned by |
|---|---|
| What happened during a lesson | Evidence spine |
| Which concepts a lesson used, at which versions | Evidence spine (`lesson.grounded` payload) |
| Which extractor and prompt produced a proposal | Knowledge provenance (§28) — permanent, not telemetry |
| Who verified a statement and when | Knowledge review log (§24) — permanent |
| Whether a topic had no knowledge | Evidence spine (`knowledge.miss`) |

**Rule:** operational history lives in the evidence log; knowledge history lives in the knowledge tables. The distinction is retention. Evidence about a request may eventually be aged out; provenance about a statement may never be.

---

# 9. The Universal Knowledge Platform

## 9.1 Five layers, strictly separated

```
┌──────────────────────────────────────────────────────────────────┐
│ L5  LEARNING          learner state, mastery, evidence           │
│                       Phase 3. Schema boundary only in Phase 2.  │
├──────────────────────────────────────────────────────────────────┤
│ L4  PROGRAM           Learning Program graph. Mappings onto L2.   │
│                       CBSE · MBBS · ABRSM · AWS · JEE            │
│                       Deleting all of L4 leaves L1–L3 intact.    │
├──────────────────────────────────────────────────────────────────┤
│ L3  ASSERTION         Statements. Contextual, versioned, sourced. │
│                       "Chlorophyll absorbs light energy"          │
├──────────────────────────────────────────────────────────────────┤
│ L2  ENTITY            Concepts + relationships. Stable identity.  │
│                       Chlorophyll · Light energy · Photosynthesis │
├──────────────────────────────────────────────────────────────────┤
│ L1  SOURCE            Documents, provenance, licences.            │
│                       NCERT Science Class 10, 2023 edition        │
└──────────────────────────────────────────────────────────────────┘
```

**Dependency direction is strictly upward-referencing-downward.** L3 references L2. L4 references L2 and L3. L5 references L2. **L2 references nothing above it.** The entity layer is the fixed point of the entire system.

Test G1 falsifies any violation: drop every L4 row and the system must still teach.

## 9.2 Why five and not three

An earlier iteration used three (Concept / Curriculum / Learning). It failed on two counts.

First, it conflated identity with assertion, which §3.5 shows is fatal to revisability.

Second, it treated sources as provenance metadata rather than as a layer. But sources have their own lifecycle: a document has a licence, an edition, a checksum, an ingestion history, and may be re-ingested when a new edition appears. Modelling it as a string on a concept makes re-ingestion impossible to reason about.

## 9.3 The read path

```
 "photosynthesis"
        │
        ▼
   search.resolve(query, ctx) ──────────▶ ConceptRef[]        (§25)
        │
        ▼
   graph.prerequisiteClosure(refs) ─────▶ ordered ConceptRef[] (§34)
        │
        ▼
   path.selectPath(refs, learner, obj) ─▶ OrderedConcept[]     (§5 of Part V)
        │                                  budget-bounded, topologically sorted
        ▼
   statement.resolveFor(concepts, ctx) ─▶ Statement[]          (§16)
        │                                  ONE statement per concept per context
        ▼
   outlineFrom(statements) ─────────────▶ OutlineSlot[]
        │
        ▼
   EXISTING PIPELINE: repairOutline → buildSkeleton → fillChunk → coerce → stream
```

Note where the model appears: **only in `fillChunk`**, and only to render statements it is given. It selects nothing and asserts nothing.

## 9.4 The write path

```
 Source document
        │
        ▼  ingest/  (pure, deterministic — same bytes, same chunk ids)
   parse → clean → normalise → chunk
        │
        ▼  advisors/knowledge/  (UNTRUSTED — the only model call)
   extract  →  Advice<RawProposal[]>
        │
        ▼  knowledge/  (deterministic)
   accept(schema)        ─── fails → discarded, logged, zero human cost
   validateQuote()       ─── quote not literally in source → discarded
   validatePayload()     ─── wrong shape for its kind → discarded
   dedupe()              ─── near-match → merge decision, not a new node
        │
        ▼
   status = PROPOSED     ─── invisible to teaching. always.
        │
        ▼  review/  (human, the only door)
   ReviewEvent { actor, decision, before, after, reason }
        │
        ▼
   status = VERIFIED     ─── now, and only now, teachable
```

**There is exactly one transition into `VERIFIED`, and it requires a human actor.** Enforced by test, not policy (§5.4).

## 9.5 Capability matrix — what each domain needs

Design validation: does the model in Part III actually serve every named domain?

| Capability | CBSE | JEE | MBBS | Law | Programming | Music | Corporate |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Stable entities | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Prerequisite DAG | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Jurisdiction scope | – | – | ✓ | **✓✓** | – | – | ✓ |
| Time validity | – | – | **✓✓** | ✓ | **✓✓** | – | ✓ |
| Authority ranking | ✓ | ✓ | **✓✓** | **✓✓** | ✓ | ✓ | ✓ |
| Evidence level | – | – | **✓✓** | ✓ | – | – | – |
| Program depth | **✓✓** | **✓✓** | ✓ | ✓ | ✓ | ✓ | ✓ |
| Exam weighting | ✓ | **✓✓** | ✓ | ✓ | ✓ | – | – |
| Procedure steps | ✓ | **✓✓** | **✓✓** | ✓ | **✓✓** | ✓ | ✓ |
| Rubric-scored skill | ✓ | – | ✓ | **✓✓** | ✓ | **✓✓** | ✓ |
| Non-text artifact | – | – | ✓ | – | **✓✓** | **✓✓** | – |
| Tenant scope | – | – | – | – | – | – | **✓✓** |

`✓✓` = load-bearing for that domain; `✓` = used; `–` = unused, null, free.

Every column is served by the same tables. Every `–` is a null column costing nothing. This is the concrete answer to §4.5: the school case uses roughly half the model and pays nothing for the other half.

---

# 10. Platform Engineering

*Everything that must work with zero content.*

## 10.1 Component inventory

| Component | Responsibility | Depends on | Empty-graph behaviour |
|---|---|---|---|
| `ids` | mint opaque ids, slug rules, resolve slug→id | – | pure |
| `objectTypes/registry` | kind → schema + capabilities | – | pure |
| `concept` | entity CRUD, aliases, tags | store, ids | empty results |
| `statement` | assertion CRUD, SPO, context binding | store, concept | empty results |
| `context` | context tuple, matching, specificity ordering | – | pure |
| `relationship` | typed edges, DAG enforcement | store, concept | empty results |
| `graph` | traversal, closure, cycle detection | store, relationship | empty path |
| `version` | version chains, releases, tombstones | store | – |
| `review` | status machine, review events | store | empty queue |
| `search` | resolve query → concepts | store | no results |
| `curriculum` | program graph, mappings | store, concept | empty tree |
| `path` | select a teaching path | graph, statement, context | **empty → caller falls back** |
| `store` | persistence interface + implementation | – | – |

Thirteen components. Nine are pure or near-pure and unit-testable with no database.

## 10.2 `KnowledgeStore` — the abstraction boundary 🔒

**ADR-2 — All persistence behind one interface**

*Context.* The platform must survive a storage change without redesign, and must not be locked to a vendor.

*Decision.* Every read and write goes through `KnowledgeStore`. No module outside `store/` imports Prisma. A conformance test suite defines correctness; any implementation passing it is substitutable.

*Alternatives.* (a) Prisma directly throughout — rejected: the logical model would acquire relational assumptions, and swapping engines would touch every file. (b) A generic repository per entity — rejected: traversal and closure are cross-entity operations that a per-entity repository cannot express efficiently.

*Consequences.* Some queries are less ergonomic than raw Prisma. Accepted. A `graph.test.ts` runs against an in-memory implementation for speed and against Postgres for fidelity, both driven by the same conformance suite.

```ts
export interface KnowledgeStore {
  // entities
  getConcept(id: ConceptId, at?: ReleaseId): Promise<Concept | null>;
  getConcepts(ids: ConceptId[], at?: ReleaseId): Promise<Concept[]>;
  resolveSlug(slug: string): Promise<ConceptId | null>;   // follows tombstones
  putConcept(c: NewConcept): Promise<ConceptId>;

  // assertions
  statementsFor(ids: ConceptId[], ctx: Context, at?: ReleaseId): Promise<Statement[]>;
  putStatement(s: NewStatement): Promise<StatementId>;

  // edges + traversal
  edgesFrom(id: ConceptId, types: EdgeType[]): Promise<Edge[]>;
  edgesTo(id: ConceptId, types: EdgeType[]): Promise<Edge[]>;
  closure(ids: ConceptId[], type: EdgeType, maxDepth: number): Promise<ClosureResult>;
  detectCycles(type: EdgeType): Promise<Cycle[]>;

  // search
  search(q: SearchQuery): Promise<SearchHit[]>;

  // programs
  programNodesFor(id: ConceptId): Promise<Mapping[]>;
  conceptsUnder(node: ProgramNodeId): Promise<Mapping[]>;

  // review + versioning
  queue(filter: QueueFilter): Promise<ReviewBatch[]>;
  applyReview(events: ReviewEvent[]): Promise<void>;   // atomic
  createRelease(label: string): Promise<ReleaseId>;
}
```

Deliberately absent: `deleteConcept`, `updateConcept`. Neither exists, because neither is permitted (§2.5). Correction is `putConcept` with `supersedes`.

## 10.3 Determinism requirements

| Operation | Guarantee | Test |
|---|---|---|
| chunking | same bytes → same chunk ids | run twice, byte-compare |
| id minting | collision-free, no meaning | statistical + no-FK-on-slug test |
| closure | same graph + inputs → same order | fixed fixture, snapshot |
| context matching | same tuple → same statement selected | table-driven |
| path selection | same inputs → identical path | snapshot |
| search rungs 1–3 | deterministic | fixture |
| extraction | **NOT deterministic** | quarantined behind `Advice<T>`; reproducibility comes from replayable chunks + recorded `promptVersion`/`modelId` |

## 10.4 Caching 🔬

Read-heavy, write-rare — the graph changes only on review.

| Cached | Key | Invalidated by |
|---|---|---|
| prerequisite closure | `conceptId + edgeType + release` | any edge write touching the subgraph |
| resolved statement | `conceptId + contextHash + release` | new/changed statement on that concept |
| program subtree | `programNodeId` | mapping change under that node |
| slug→id | `slug` | tombstone or slug change |

Marked provisional: invalidation granularity is a guess until real edge-write patterns are observed. The conservative fallback — invalidate the whole cache on any review batch commit — is correct, cheap at current volumes, and should be the v1 implementation.

---

# 11. Content Engineering

*Everything that puts knowledge in. Strictly separated from Part 10.*

## 11.1 The separation, stated as a rule

> **Platform code may never import ingestion code. Ingestion code may never write to the store directly.**

The pipeline produces *proposals*. Only `review/` — driven by a human — commits them. This is enforced in `architecture.test.ts` alongside the existing three walls.

The reason is not tidiness. It is that the platform must be independently testable and independently correct. If ingestion could write, then a pipeline bug would be a graph corruption. With the separation, a pipeline bug is a bad proposal that a reviewer rejects.

## 11.2 Pipeline stages

| Stage | Pure? | Model? | Output | Failure mode |
|---|:-:|:-:|---|---|
| `fetch` | no (I/O) | no | `RawSource` + bytes | network, licence refusal |
| `parse` | yes | no | text + locators | unsupported format |
| `clean` | yes | no | text minus furniture | over-stripping (tested) |
| `normalise` | yes | no | canonical text | – |
| `chunk` | yes | no | `Chunk[]` with content-addressed ids | – |
| `extract` | **no** | **yes** | `Advice<RawProposal[]>` | hallucination → caught downstream |
| `validate` | yes | no | `Proposal[]` | rejects silently, logs |
| `dedupe` | yes | no | `Proposal[]` + merge candidates | threshold error → human sees it |
| `stage` | no (write) | no | rows at `PROPOSED` | – |
| `review` | no (human) | no | `VERIFIED` | the only door |

**Stages 2–5 are pure functions.** Same source bytes produce byte-identical chunk ids on any machine at any time. This is what makes extraction re-runnable: when a better model appears, re-extract from identical chunks and diff the proposals against what was verified.

## 11.3 Locator preservation 🔒

Every stage from `parse` onward MUST carry a **locator** — `{ page, section, paragraph, charRange }` — through to the proposal.

This is load-bearing because a statement whose source location was lost is permanently unverifiable. It cannot be recovered later: once the text has been cleaned and chunked without locators, the mapping back to the page is gone.

Cleaning and normalisation therefore operate on a **span-preserving representation**, not on a plain string. Stripping a header adjusts offsets rather than discarding them.

## 11.4 The extractor 🔬

The only model call in Phase 2. Located at `src/server/advisors/knowledge/extract.ts` — which the existing architecture test forces, since it imports an AI SDK.

**Contract:**

```ts
extract(chunk: Chunk, hints: ExtractHints): Promise<Advice<RawProposal[]>>
```

**Required of every proposal:**

| Field | Why mandatory |
|---|---|
| `quote` — verbatim span from the chunk | machine-checkable grounding (§4.2). No quote → auto-reject. |
| `kind` | selects the payload schema |
| `payload` | validated against the kind's schema |
| `conceptRefs` — entities by **name** | resolution happens deterministically, not by the model |
| `locator` | traceability |

**Explicitly forbidden from the extractor:**

- Assigning IDs. The platform mints identity; a model must never choose it.
- Asserting `VERIFIED`. Not representable in the schema it returns.
- Creating edges to concept **IDs**. It proposes by name; `dedupe`/resolution decides whether that name is an existing entity.
- Assigning difficulty. Does not exist as a field (§7.1).

Marked provisional: the prompt, the chunk size, and whether extraction is one pass or split into entity-extraction then statement-extraction are all guesses until measured against the golden set (§44).

## 11.5 Multi-pass extraction 🔬

Likely necessary, unproven:

1. **Entity pass** — identify concept entities in the chunk; resolve against existing graph.
2. **Statement pass** — given resolved entities, extract assertions linking them.
3. **Relationship pass** — propose prerequisite edges.
4. **Assessment pass** — propose items from exercises, where present.

Separating passes makes each individually evaluable and lets a weaker/cheaper model handle the easier passes. It also lets entity resolution happen *before* statements are formed, which materially reduces duplicate creation.

The alternative — single-pass, everything at once — is cheaper in tokens and simpler, and may prove adequate. Decide on evidence from Phase 2A, not now.

## 11.6 Re-ingestion and editions

A new NCERT edition arrives. The platform must not duplicate.

```
new edition → checksum differs → new Source row (edition: "2026")
            → chunk → chunk ids differ where text changed, identical where not
            → extract ONLY changed chunks
            → proposals dedupe against existing concepts
            → unchanged statements: new ConceptSource row (same statement, new edition)
            → changed statements: new VERSION of the statement, old superseded
            → removed statements: flagged for review as possibly deprecated
```

Content-addressed chunk ids make this a diff rather than a re-ingestion. The reviewer sees only what actually changed — typically a small fraction of a chapter.

---

*End of Part II. Part III — The Knowledge Model (§12–20) follows in `03-knowledge-model.md`.*
