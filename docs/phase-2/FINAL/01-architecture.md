# Part II — Architecture

---

# 8. Overall Platform Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ L6  OBSERVATION      SEPARATE DATABASE. append-only. erasable.       │
│                      Mastery and efficacy are QUERIES over this.     │
├──────────────────────────────────────────────────────────────────────┤
│ L5  PROGRAM          Learning Programs → mappings onto L2.           │
│                      Delete all of L5 → L1-L4 unharmed.              │
├──────────────────────────────────────────────────────────────────────┤
│ L4  TEACHING         how to teach it. misconceptions, analogies,     │
│                      worked examples, diagram specs, Socratic paths. │
├──────────────────────────────────────────────────────────────────────┤
│ L3  ASSERTION        what is true, under which conditions,           │
│                      at which trust level, on whose authority.       │
├──────────────────────────────────────────────────────────────────────┤
│ L2  ENTITY           what exists. THREE graphs:                      │
│                      DEPENDENCY (acyclic) · COMPOSITION (acyclic)    │
│                      · REINFORCEMENT (cyclic)                        │
├──────────────────────────────────────────────────────────────────────┤
│ L1  SOURCE           documents, provenance, licence, checksum.       │
└──────────────────────────────────────────────────────────────────────┘

References point DOWNWARD only. L2 references nothing above it.
L3 and L4 are PEERS. Neither derives from the other.
```

## 8.1 Relationship to Phase 1

Phase 1's three walls are extended, not replaced. `architecture.test.ts` walks `src/server` and forbids any file outside `advisors/` from importing an AI SDK — **with no `import type` exemption**. `Advice<T>` carries `unknown` and its only exit is `accept(advice, schema)`.

Knowledge extraction is the identical problem shape as intent classification: an untrusted model proposing something deterministic code must validate. **The extractor therefore lives under `advisors/` by force of the existing rule, returns `Advice<T>`, and cannot express a trust level above `MACHINE_PROPOSED` because its return type has no such field.** No new trust boundary is invented.

## 8.2 Integration point

Exactly one call site changes:

```ts
// manager.ts — startLesson()
const hits = await knowledge.resolve({ text: topic, context: ctx.learnerContext, trustPolicy: policy });
const plan = hits.length ? await knowledge.selectPath(hits, ctx.learner, "LEARN", policy, BUDGET) : null;
const proposed = plan ? outlineFrom(plan, topic) : defaultOutline(topic);
const { outline } = repairOutline(proposed, topic);
if (!plan) void emit(userId, EVENTS.knowledgeMiss, { topic }, "server", sessionId);
```

`repairOutline`, `buildSkeleton`, `coerceSlot`, `adaptBlock`, `fillChunk` and every renderer are untouched. The visual guarantee, skeleton-first rendering and the fill ladder all keep working. **A knowledge platform that requires rewriting the teaching engine has failed its integration test before it is built.**

---

# 9. Component Architecture

```
src/server/
  knowledge/                     PLATFORM. pure + store. never imports advisors/
    concept.ts                   entities, aliases, tags, merge, SPLIT
    statement.ts                 assertions; SPO is one form of seven
    context/ registry.ts match.ts canonical.ts
    graph/
      dependency.ts              REQUIRES. acyclic. topological sort.
      composition.ts             PART_OF. acyclic. rollup.
      reinforcement.ts           everything else. cycles legal.
      traverse.ts                bounded closure, shared
    trust/
      ladder.ts validators/ corroboration.ts contradiction.ts
      inference.ts policy.ts promote.ts
    teaching/ asset.ts registry.ts select.ts
    assessment/ item.ts registry.ts
    curriculum.ts search.ts version.ts review.ts path.ts ids.ts
    store/ KnowledgeStore.ts postgres.ts conformance.test.ts
  observation/                   SEPARATE STORE
    record.ts mastery.ts efficacy.ts earn.ts
  ingest/                        pure. no models, no store.
    parse/ clean.ts normalise.ts chunk.ts pipeline.ts
  advisors/knowledge/            UNTRUSTED. the only models.
    extractEntities.ts extractStatements.ts extractDependencies.ts extractAssets.ts
  review/ queue.ts batch.ts decide.ts merge.ts split.ts
```

## 9.1 Wall rules (extending `architecture.test.ts`)

| # | Rule | Prevents |
|---|---|---|
| W1 | only `advisors/**` imports an AI SDK | Phase 1 wall |
| W2 | `knowledge/**` never imports `advisors/**` | knowledge depending on proposal |
| W3 | `ingest/**` never imports the store | pipeline writing directly |
| W4 | `observation/**` never imports `knowledge/store` | store coupling |
| W5 | nothing outside `store/**` imports Prisma | engine lock-in |
| W6 | `graph/dependency.ts` never imports `graph/reinforcement.ts` | the two graphs silently re-merging |
| W7 | `graph/composition.ts` never imports either of the others | same |

**W6 and W7 are the structural defence against premortem cause 5.** A refactor that unifies the graphs must delete a test to succeed, which makes the decision visible.

---

# 10. Complete Data Model

*Consolidated and binding. Naming resolved per C1: the entity is `Statement`.*

```prisma
// ═══════ L1 SOURCE ═══════
model Source {
  id String @id  kind String  title String  publisher String  authority String
  edition String?  publishedAt DateTime?  uri String?
  checksum String @unique  license String  licenseUrl String?
  ingestedAt DateTime @default(now())
}
model SourceChunk {
  id String @id                    // sha256(sourceId + locator + normalisedText)
  sourceId String  locator Json  text String  ordinal Int
  @@index([sourceId, ordinal])
}
model Provenance {
  statementId String  sourceId String  chunkId String
  locator Json  quote String       // verification ONLY. never served (§27).
  extractorVersion String  promptVersion String  modelId String
  extractedAt DateTime
  @@id([statementId, chunkId])
  @@index([sourceId])
}

// ═══════ L2 ENTITY ═══════
model Concept {
  id String @id                    // opaque cuid2. IMMUTABLE. meaningless.
  slug String @unique              // MUTABLE. never an FK target.
  name String
  kind String @default("ENTITY")   // ENTITY | SKILL | ... (registry)
  scope String @default("PUBLIC")  // PUBLIC | tenant:<id>
  status String @default("DRAFT")  // DRAFT|ACTIVE|DEPRECATED|MERGED|SPLIT
  version Int @default(1)  supersedes String?
  mergedInto String?               // tombstone → single target
  splitInto String[]               // tombstone → AMBIGUOUS, resolved by usage context
  createdAt DateTime @default(now())
  @@index([status, kind])
  @@index([scope, status])
}
model ConceptAlias {
  conceptId String  alias String  language String @default("en")
  kind String @default("SYNONYM")  // SYNONYM|ABBREV|TRANSLATION|MISSPELLING|FORMER_NAME
  @@id([conceptId, alias, language])
  @@index([alias])
}
model ConceptTag {
  conceptId String  namespace String  value String
  @@id([conceptId, namespace, value])
  @@index([namespace, value])
}

// ─── THREE graphs. Three tables. Never unified. ───
model DependencyEdge {             // REQUIRES. ACYCLIC (enforced).
  fromId String  toId String  strength Float @default(1)
  contextId String?                // null = cognitive; set = curricular sequencing
  version Int @default(1)  supersedes String?
  @@id([fromId, toId, version])
  @@index([toId])
}
model CompositionEdge {            // PART_OF. ACYCLIC (enforced). C2.
  partId String  wholeId String  ordinal Int?
  version Int @default(1)
  @@id([partId, wholeId, version])
  @@index([wholeId])
}
model ReinforcementEdge {          // cycles LEGAL and expected.
  fromId String  toId String
  type String   // ENABLES|REINFORCES|REVISITS|TRANSFER_TO|CO_OCCURS
                // |COMMON_CONFUSION|ANALOGOUS_TO|CONTRASTS|SUCCEEDS
  strength Float @default(1)
  earned Boolean @default(false)   // true = derived from observation
  contextId String?
  version Int @default(1)
  @@id([fromId, toId, type, version])
  @@index([toId, type])
}

// ═══════ L3 ASSERTION ═══════
model ContextDimension {           // OPEN REGISTRY. adding one is an INSERT.
  key String @id                   // jurisdiction, physicsRegime, musicTradition…
  valueType String                 // enum|iso3166|iso639|range|date|string
  values String[]  specificity Int  appliesTo String[]  since String
}
model Context {
  id String @id                    // sha256(canonicalJSON(dimensions)) — see §13.2
  dimensions Json
  @@index([dimensions], type: Gin)
}
model Statement {
  id String @id
  kind String                      // FACT|PROCEDURE|PRINCIPLE|RULE|… (registry)
  form String                      // SPO|CONDITIONAL|QUANTIFIED|CAUSAL
                                   // |COMPARATIVE|PROBABILISTIC|DEFINITIONAL
  structure Json                   // form-specific. SPO is ONE case.
  subjectId String?                // denormalised SPO index (form=SPO only)
  predicate String?
  objectId String?  objectLit String?
  text String                      // WRITTEN, never copied (§27.2)
  payload Json                     // kind-specific, registry-validated
  contextId String
  scope String @default("PUBLIC")
  // trust — every field is EVIDENCE, never a conclusion
  trustLevel String @default("MACHINE_PROPOSED")
  validationMethods String[]
  corroborationCount Int @default(0)
  independentSourceCount Int @default(0)
  derivedFrom String[]             // inference chain
  authority String?
  evidenceLevel String?
  version Int @default(1)  supersedes String?
  createdAt DateTime @default(now())
  @@index([subjectId, trustLevel])
  @@index([contextId])
  @@index([predicate, objectId])
}
model Contradiction {
  id String @id  aId String  bId String  form String  contextOverlap Json
  status String                    // OPEN|RESOLVED|COEXIST
  detectedAt DateTime  resolvedBy String?
  @@index([aId])  @@index([bId])
}

// ═══════ L4 TEACHING ═══════
model TeachingAsset {
  id String @id
  kind String                      // MISCONCEPTION|ANALOGY|WORKED_EXAMPLE|… (registry)
  conceptId String  statementId String?
  payload Json                     // ANALOGY MUST carry breakdownPoint (V14)
  contextId String
  trustLevel String @default("MACHINE_PROPOSED")
  scope String @default("PUBLIC")
  version Int @default(1)  supersedes String?
  @@index([conceptId, kind, trustLevel])
}
model AssetEfficacy {              // DERIVED. never authored.
  assetId String  contextId String
  exposures Int  subsequentSuccess Int  computedAt DateTime
  @@id([assetId, contextId])
}

// ═══════ ASSESSMENT (C3 — in scope, scheduled 2E) ═══════
model AssessmentItem {
  id String @id  kind String       // MCQ|SHORT|NUMERIC|ORDERING|MATCHING|ARTIFACT|CODE
  prompt String  payload Json      // distractors carry diagnosesMisconception
  contextId String  scope String @default("PUBLIC")
  trustLevel String @default("MACHINE_PROPOSED")
  version Int @default(1)  supersedes String?
}
model ItemConcept {
  itemId String  conceptId String  role String  bloom String?
  @@id([itemId, conceptId])
}

// ═══════ L5 PROGRAM ═══════
model Program {
  id String @id  slug String @unique  name String
  kind String                      // SCHOOL_BOARD|DEGREE|CERTIFICATION|EXAM|COURSE|INTERNAL
  authority String  jurisdiction String?
  scope String @default("PUBLIC")  version String
}
model ProgramNode {
  id String @id  programId String  parentId String?
  nodeKind String                  // DOMAIN|TRACK|LEVEL|MODULE|UNIT|TOPIC|ROTATION|GRADE|PAPER
  name String  ordinal Int  code String?
  @@index([programId, parentId, ordinal])
}
model Mapping {
  programNodeId String  conceptId String
  depth String                     // INTRODUCE|DEVELOP|MASTER|REVISE|ASSUMED
  ordinal Int  examWeight Float?  required Boolean @default(true)
  @@id([programNodeId, conceptId])
  @@index([conceptId])
}
model LearningObjective {
  id String @id  programNodeId String  statement String  bloom String  ordinal Int
}
model ObjectiveConcept {
  objectiveId String  conceptId String  role String
  @@id([objectiveId, conceptId])
}

// ═══════ GOVERNANCE ═══════
model ReviewEvent {
  id String @id  targetKind String  targetId String
  decision String                  // APPROVE|REJECT|EDIT|MERGE|SPLIT|DISPUTE|PROMOTE|DEMOTE
  fromTrust String?  toTrust String?
  actorId String                   // a human. always.
  before Json?  after Json?  reason String?  batchId String?
  createdAt DateTime @default(now())
  @@index([targetKind, targetId])
  @@index([actorId])               // reputation
}
model Release       { id String @id  label String  createdAt DateTime  frozen Boolean }
model ReleaseMember { releaseId String  kind String  entityId String
                      @@id([releaseId, kind, entityId]) }
model ClosureCache  { conceptId String  releaseId String  closure Json  computedAt DateTime
                      @@id([conceptId, releaseId]) }

// ═══════ L6 OBSERVATION — SEPARATE DATABASE ═══════
model Observation {
  id String @id  learnerId String  taskId String?
  conceptIds String[]
  contextId String                 // REQUIRED. makes future SPLIT resolvable.
  outcome Json  bloomLevel String?
  assetIds String[]  releaseId String
  occurredAt DateTime
  @@index([learnerId, occurredAt])
  @@index([conceptIds], type: Gin)
}
// NO mastery table. Mastery is a query (§20.2).
```

## 10.1 Deliberately absent

`difficulty` anywhere · a mastery score · `subject` on `Concept` · `chapter` on `Concept` · any curriculum FK on knowledge · a unified `Edge` table · `verified: boolean` · `quality` on assets · any `DELETE` path.

---

# 11. Knowledge Graph Architecture

## 11.1 Dependency graph — `REQUIRES`, acyclic 🔒

**Why acyclic, argued rather than asserted:** if a genuine cycle existed in knowledge dependency, no learner could construct an entry point and the subject would be unlearnable. Every subject is learnable by someone starting from nothing. Therefore dependency has an acyclic core.

Apparent counterexamples all dissolve:

| Apparent cycle | Resolution |
|---|---|
| limits ⇄ derivatives | `derivatives REQUIRES limits`. The reverse arrow is `REINFORCES`. |
| vocabulary ⇄ reading | reading requires a *minimal* vocabulary — a smaller, different concept |
| force ⇄ mass | both require a prior operational concept; `F=ma` relates them |
| grammar ⇄ writing | `REINFORCES` both ways; children write before knowing grammar |

Every one is a reinforcement relationship misfiled as a prerequisite. **The DAG constraint's value is that it forces that distinction to be made explicitly.**

## 11.2 Reinforcement graph — cyclic by design 🔒

`Functions → Derivatives → Optimisation → Functions` is legal and true. So is `Photosynthesis ⇄ Respiration ⇄ Energy`.

`COMMON_CONFUSION` is load-bearing for teaching: learners conflate weight/mass, velocity/acceleration, precision/accuracy. That is a fact about **minds**, not the world, and it tells the Teaching Engine what to disambiguate *before* the conflation forms.

Reinforcement edges should eventually be **earned** from observation — if mastering X measurably improves later performance on Y, that is an edge with evidence. `earned: boolean` distinguishes authored from measured.

## 11.3 Composition graph — `PART_OF`, acyclic (C2 restoration)

*Light reaction* PART_OF *photosynthesis*. Neither a prerequisite nor a reinforcement: you do not need the whole to learn the part, and learning the part is not merely reinforcement of the whole. It is **structural containment**, needed for aggregation, topic rollup, and progress summarisation ("you have covered 4 of 7 parts").

Acyclic for the obvious reason: a thing cannot be part of itself transitively.

## 11.4 Why three tables, not one with a type column

A single table invites a single traversal function, which invites running a topological sort over cyclic edges. Separate tables plus wall rules W6/W7 make that a compile-and-test failure rather than a subtle runtime bug.

## 11.5 Conflict between graphs 🔒

**Binding rule:** the same ordered pair may not appear in both `DependencyEdge` and `ReinforcementEdge` in the same direction. If `A REQUIRES B` exists, `A REINFORCES B` is rejected — dependency is the stronger claim and subsumes it. The reverse pair (`B REINFORCES A`) is legal and common, and is exactly the limits/derivatives case.

Validated on write and as a standing whole-graph test.

---

# 12. Content Engineering Architecture

## 12.1 Pipeline

```
fetch → parse → clean → normalise → chunk → EXTRACT → validate
     → resolve → corroborate → contradict → promote → review
```

Stages 2–5 are **pure**: identical bytes produce identical chunk ids on any machine at any time. Extraction is the only nondeterministic stage and is quarantined behind `Advice<T>`.

The pipeline **terminates at a trust level, not at a human.** A statement may legitimately stop at `AUTO_VALIDATED` and be teachable to a consumer whose policy accepts that floor.

## 12.2 Span-preserving cleaning 🔒

```ts
interface Span { text: string; sourceRange: [number, number]; page: number }
type Doc = Span[]
```

Removing a header drops a span; other offsets stay intact. A quote's character range therefore maps back to the original page after every transformation — which is what makes grounding checkable and highlighted review possible. Doing this on plain strings destroys the mapping irrecoverably.

## 12.3 Chunking

`chunkId = sha256(sourceId + JSON(locator) + normalisedText)`. Content-addressed, so **re-ingestion is a diff**: an unchanged chapter produces identical ids and zero work; one edited paragraph produces one new id.

## 12.4 Four extraction passes

| Pass | In | Out | Note |
|---|---|---|---|
| 1 entities | chunk | concept candidates resolved against graph + aliases | resolution before creation prevents duplicates at proposal time |
| 2 statements | chunk + resolved entities | assertions linking known entities | |
| 3 dependencies | chunk + entities | `REQUIRES` / `PART_OF` / reinforcement, **classified** | **always human-confirmed regardless of trust** — this is what keeps the DAG honest |
| 4 assets | verified chapter | teaching assets | runs only over verified knowledge |

## 12.5 Halt conditions

>50% batch validation failure → halt the source. >30% duplicate hits → halt, source probably already ingested. Contradiction rate above baseline → halt.

The expensive failure is not a rejected proposal; it is thousands of subtly wrong ones consuming review capacity.

---

# 13. Teaching Metadata Architecture

## 13.1 Why this layer is the product

**Knowledge:** *photosynthesis converts light energy into chemical energy.* True, verifiable, in every textbook, **known by every model.**

**Teaching knowledge:** *a fifteen-year-old who just learned that plants "make food from sunlight" will assume the plant is eating the sunlight; name that assumption before introducing the equation, or the equation lands on a wrong model and reinforces it.* Not true or false, in no textbook, **not reliably known by any model.**

Grounding makes lessons accurate. Accuracy is commodity. Without L4, a fully grounded lesson can be dull and badly pitched, the quality metric comes back flat, and the wrong conclusion gets drawn.

**Binding rule:** the Teaching Engine never invents pedagogy. It retrieves and composes. Where assets are absent it falls back to model-generated presentation, clearly marked, and records `teaching.miss`.

## 13.2 Asset kinds (registry)

*Explanation* — `INTUITIVE_EXPLANATION`, `FORMAL_EXPLANATION`, `ANALOGY`, `MENTAL_MODEL`, `STORY`, `MEMORY_ANCHOR`.
*Demonstration* — `WORKED_EXAMPLE`, `COUNTEREXAMPLE`, `EXPERIMENT`, `SIMULATION`, `REAL_WORLD_APPLICATION`.
*Visual* — `DIAGRAM_SPEC` (binds to Agabi's existing 40+ block catalogue), `WHITEBOARD_FLOW`, `ANIMATION_SPEC`.
*Misconception* — `MISCONCEPTION`, `MISCONCEPTION_CORRECTION`, `DISCRIMINATION`.
*Interaction* — `SOCRATIC_SEQUENCE`, `RETRIEVAL_PROMPT`, `EXERCISE`, `PROJECT`.
*Strategy* — `TEACHING_STRATEGY`, `TEACHING_ORDER`, `AGE_ADAPTATION`, `DIFFICULTY_ADAPTATION`, `REVISION_STRATEGY`.

## 13.3 `ANALOGY.breakdownPoint` is mandatory 🔒

Every analogy is wrong somewhere. Taught without its limit, it **installs a misconception**: the learner extends the mapping past where it holds and is confidently wrong in a way that is hard to detect and harder to unlearn.

*"Current is like water in a pipe"* is excellent for flow and resistance, and breaks at capacitance, at charge not being consumed, and at signal propagation speed.

Required by schema (V14), not by convention. Impossible to retrofit across thousands of assets.

## 13.4 Efficacy is observed, never authored

No `quality` column. Efficacy accumulates from L6: did learners who received this asset perform better afterwards? An authored rating is an opinion; a measured one is evidence.

## 13.5 Phase 2 scope

Build the schema, registry, trust integration, `assetsFor()`, and efficacy structure. Populate **`MISCONCEPTION`, `ANALOGY`, `WORKED_EXAMPLE` only**, for chapters already knowledge-verified. Twenty-plus kinds designed against no source material would be twenty-plus guesses.

---

# 14. Validation Architecture

| # | Gate | Check | Failure |
|---|---|---|---|
| V1 | schema | `accept(advice, schema)` | discard batch |
| V2 | payload | registry schema for kind | discard |
| V3 | **grounding** | normalised quote literally contained in chunk | **discard** |
| V4 | quote length | 10 ≤ n ≤ 500 | discard |
| V5 | originality | `text` not a substring of `quote` | flag — copyright |
| V6 | entity resolution | names resolve or flagged new | flag |
| V7 | **dependency acyclicity** | proposed `REQUIRES` closes no cycle | **reject, show cycle** |
| V8 | composition acyclicity | proposed `PART_OF` closes no cycle | reject |
| V9 | **edge classification** | prerequisite / composition / reinforcement stated | **always human-confirmed** |
| V10 | graph conflict | pair not already in dependency, same direction (§11.5) | reject |
| V11 | context validity | dimensions registered; validFrom < validUntil | discard |
| V12 | units and dimensions | numeric claims dimensionally consistent | flag |
| V13 | scope | tenant proposal references no other tenant | discard + security alert |
| V14 | **analogy breakdown** | every `ANALOGY` states where it fails | **discard** |
| V15 | self-reference | subject ≠ object | discard |

Passing every applicable gate **is** `AUTO_VALIDATED` — a defined epistemic state, not a waiting room.

## 14.1 V3 — grounding

```ts
const n = (s: string) => s.normalize("NFC")
  .replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g," ").trim().toLowerCase();
if (!n(chunk.text).includes(n(quote))) reject("QUOTE_NOT_IN_SOURCE");
```

**Deliberately not fuzzy.** A model paraphrasing while claiming to quote is doing exactly what this catches. Returns the char range, which powers highlighted review.

## 14.2 Context canonical hashing 🔒 (C5)

```ts
canonical(dims) = JSON.stringify(
  Object.keys(dims).sort().map(k => [k, normaliseValue(registry[k].valueType, dims[k])])
);
contextId = sha256(canonical(dims));
```

Without deterministic canonicalisation, two identical contexts produce two rows and specificity matching silently fragments. `normaliseValue` is per-dimension-type: ISO codes uppercased, dates to UTC midnight, enums exact-matched.

## 14.3 Contradiction as a validator 🔒

A new statement conflicting with a higher-trust statement in an overlapping context **cannot promote** above `AUTO_VALIDATED` and is surfaced to review as a *challenge*, not a candidate.

**The graph defends itself and improves at it as it grows.** Human effort per statement falls with graph size — the only mechanism that makes 100M concepts arithmetically conceivable.

## 14.4 Per-form contradiction rules (C4)

| Form | Conflict rule |
|---|---|
| `SPO` | same subject + predicate, overlapping context, different object |
| `DEFINITIONAL` | same definiendum, different definiens — always a conflict |
| `COMPARATIVE` | same pair + dimension, opposite direction |
| `QUANTIFIED` | universal vs existential counterexample over the same domain |
| `CONDITIONAL` | same antecedent, contradictory consequents |
| `CAUSAL` | same cause + effect, opposite sign |
| `PROBABILISTIC` | **non-overlapping confidence intervals** on the same quantity |

Forms not listed are **explicitly undetectable** and marked as such rather than silently passing — an undetected conflict must never look like an absence of conflict.

---

# 15. Search Architecture

Search resolves **concepts**, never documents. Output is `ConceptRef[]`.

| Rung | Method | Deterministic | Ships |
|---|---|:-:|:-:|
| 1 | exact slug | yes | 2A |
| 2 | alias (incl. translations, former names) | yes | 2A |
| 3 | trigram over name, aliases, statement text | yes | 2D |
| 4 | vector | no | when rung 3 measurably fails |

For a syllabus term, exact matching is *better* than semantic — it cannot drift, it is explainable, and it replays identically.

```ts
interface SearchQuery {
  text?: string; kinds?: string[]; tags?: Tag[]; program?: ProgramNodeId;
  context?: Context;
  relatedTo?: ConceptId;    // reinforcement
  requires?: ConceptId;     // dependency, reverse
  partOf?: ConceptId;       // composition
  trustPolicy: TrustPolicy; // REQUIRED. no default.
  scope?: string;
}
interface SearchHit {
  conceptId: ConceptId; score: number;
  rung: 1|2|3|4; matchedOn: string; trustLevel: TrustLevel;
}
```

`trustPolicy` having no default makes it impossible to accidentally surface machine-proposed knowledge to a student. `rung` and `matchedOn` make every result explainable — a search that cannot say why it matched cannot be trusted in a teaching path.

Coverage: concept, statement, skill, objective, alias, dependency, relationship, tag, curriculum, and future semantic — all resolving to concepts.

---

# 16. API Architecture

Internal TypeScript modules in Phase 2. No public HTTP knowledge API — one with no consumer cannot be designed correctly.

```ts
export const knowledge = {
  resolve(q: SearchQuery): SearchHit[];
  getConcept(idOrSlug, at?: ReleaseId): Concept | null;
  statementsFor(ids, ctx, policy: TrustPolicy, at?): Statement[];
  prerequisitesOf(id, depth): OrderedConcept[];   // dependency
  dependentsOf(id): ConceptRef[];                 // dependency reverse
  partsOf(id): ConceptRef[];                      // composition
  reinforcementsOf(id, types): ConceptRef[];      // cyclic
  assetsFor(concepts, ctx, policy): TeachingAsset[];
  itemsFor(concepts, ctx, policy): AssessmentItem[];
  curriculumFor(id): Mapping[];
  conceptsUnder(programNodeId): Mapping[];
  selectPath(seeds, learner, objective, policy, budget): LessonPlan;
};
export const observation = {
  record(o: NewObservation): void;
  mastery(learnerId, conceptId, atBloom?, asOf?): MasteryEstimate;
  efficacy(assetId, ctx): EfficacyEstimate;
};
```

The three graphs are **named apart**, never `getEdges(type)`. `TrustPolicy` is required on every content-returning call.

---

# 17. Storage Architecture

## 17.1 Three stores

| Store | Holds | Properties |
|---|---|---|
| **Knowledge** (Postgres) | L1–L5 | append-only · versioned · public · permanent · low write volume |
| **Observation** (Postgres, separate instance) | L6 | append-only · high volume · private · erasable · time-partitioned |
| **Derived** | closures, search index, efficacy rollups | **rebuildable · never authoritative** |

## 17.2 Why Postgres 🔒

1. **Atomic multi-row writes with auditable history are non-negotiable.** A review commits statements, edges, assets and events together or not at all. Without transactions a partial failure is silent corruption with no consistent state to compare against.
2. **The workload is majority-relational.** Context ranking, trust filtering, text matching and analytics are relational. Genuine graph traversal is bounded (`REQUIRES` closure is single-digit depth by cognitive necessity) and cacheable.
3. Already deployed. Zero new infrastructure for a product with no users.
4. `KnowledgeStore` makes it reversible at the cost of one file.

**Rejected:** Neo4j/Memgraph (optimises a minority workload; licence lock-in; weaker on the majority patterns) · document stores (no recursive traversal; the model is highly relational) · search indexes as canonical (no transactions, no referential integrity — a projection, never truth) · triple stores (context is second-class; payloads are not triples).

**Falsifier:** if `REQUIRES`-closure p95 exceeds 50 ms *with* the closure cache, introduce a traversal engine as a derived store behind the same interface. Not before.

---

# 18. Indexing Strategy

Full index inventory as in the schema, plus:

**Partial indexes** — most reads touch only high-trust current rows:
```sql
CREATE INDEX stmt_teachable ON "Statement" ("subjectId","contextId")
  WHERE "trustLevel" IN ('OFFICIAL_SOURCE_VERIFIED','AGABI_CANONICAL','EXPERT_REVIEWED');
```

**Closure cache** removes dependency traversal from the hot path: `(conceptId, releaseId) → ordered prerequisite list`. **v1 invalidation clears the whole cache on any review commit** — crude, correct, cheap. Subgraph-precise invalidation is deferred (§34-D3), because premature precision risks a staleness bug that is very hard to detect.

**GIN trigram** on `ConceptAlias.alias` and `Statement.text` for rung 3. **GIN** on `Context.dimensions` and `Observation.conceptIds`.

---

*Part III — operations, trust, security, assurance.*
