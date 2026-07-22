# RFC-2 · Part VI — Versioning, Migration, Risk, Premortem, Schema

---

# 37. Versioning Architecture 🔒

## 37.1 Nothing is overwritten

Every mutable entity carries `version` and `supersedes`. Editing creates a row; the old is `DEPRECATED` and readable forever.

*Why not mutate with an audit log:* reconstructing old state means replaying the log backwards — fragile and slow. *Why not temporal tables:* Postgres-specific, violating engine independence. Explicit chains are portable and obvious.

| Entity | Versioned | Note |
|---|:-:|---|
| Concept | yes | rare — identity is stable by design |
| Proposition | **yes** | the common case |
| DependencyEdge | yes | prerequisites get revised |
| ReinforcementEdge | yes | and increasingly *earned* from evidence |
| TeachingAsset | **yes** | assets improve; old ones must stay replayable |
| Mapping | yes | syllabi change between editions |
| Context | **no** | immutable by construction — id is the hash of its dimensions |
| Observation | **no** | append-only fact about a moment |

## 37.2 Trust level is versioned with the row

A promotion or demotion creates a new version. This matters: *"was this `OFFICIAL_SOURCE_VERIFIED` when we taught it in March?"* must be answerable. Storing trust as a mutable column would make every historical trust claim unverifiable — the exact failure §37.1 exists to prevent.

## 37.3 Releases 🔒

```prisma
model Release       { id String @id  label String  createdAt DateTime  frozen Boolean }
model ReleaseMember { releaseId String  kind String  entityId String  @@id([releaseId, kind, entityId]) }
```

A release pins **exact version ids**. Every lesson records the release it taught against. Replaying a 2026 lesson in 2029 resolves every proposition and every teaching asset to the version the learner actually saw — not the current text of the same concept.

## 37.4 Merge and split

**Merge** — move aliases, tags, propositions, both kinds of edge, assets and mappings to the winner; tombstone the loser with `mergedInto`; the loser's id resolves forever. Non-destructive, which is what makes reviewers willing to do it.

**Split** (§17.2) — the harder direction. Statements and edges are re-attributed per item; observations are apportioned **by the context recorded on each observation**, never guessed; the source is tombstoned with a `SPLIT` marker and resolution becomes explicitly **ambiguous** rather than silently wrong.

This is why every concept reference records its usage context (R2-6). Without it, split is unresolvable and the platform must either guess or refuse.

---

# 38. Migration Strategy

## 38.1 Into the platform

Nothing to migrate — Agabi stores no knowledge today. Phase 2 is purely additive: new tables, a second database for observations, and one changed call site in `manager.ts`.

**Rollback stays trivial through 2A–2D:** revert `startLesson` to `defaultOutline(topic)`. Knowledge tables become inert. No data loss. Until grounding is proven (§28.1), the ability to switch it off in one line is the safety net.

## 38.2 Migrations the architecture must never require

| Would-be migration | Prevented by |
|---|---|
| add a context dimension | open registry (§18) |
| add a knowledge or asset type | registries (R2-13) |
| add a trust level | ladder is data, not an enum in code |
| separate prerequisite from reinforcement edges | already separate (§15/§16) |
| add pedagogy | L4 exists (Part III) |
| recompute mastery under a better model | mastery is a query (§25.2) |
| split a conflated concept | first-class, and references carry context (§17.2) |
| add a curriculum | mapping layer (§21) |
| add a tenant | `scope` ships in v1 |
| erase a learner without touching knowledge | separate stores (§25.3) |
| recover overwritten knowledge | never overwritten (§37) |
| backfill provenance | mandatory from the first row |
| add difficulty semantics | never stored; always derived |

Thirteen migrations prevented by decisions that cost nothing today. **This table is the actual deliverable of the phase** — it is what "no architectural redesign should ever be required" means concretely.

## 38.3 Migrations that will legitimately happen

| Migration | Cost | Trigger |
|---|---|---|
| authored reinforcement edges → earned | additive; both retained | observation data exists |
| trigram search → vector | additive rung | rung 3 measurably insufficient |
| misconception payload field → first-class concept | additive | Mastery Engine needs diagnosis |
| partition observations by time | operational | volume |
| traversal engine as derived store | additive | DAG p95 > 50 ms *with* cache |

All additive. None re-authors content.

---

# 39. Risk Analysis

| # | Risk | Severity | Detection | Mitigation |
|---|---|---|---|---|
| R1 | **Content never gets populated** | terminal | coverage metric flat | graceful degradation; miss-driven priority; 2A is one chapter end to end |
| R2 | **Trust ladder is gamed by volume** — mass low-quality proposals reach `AUTO_VALIDATED` | high | promotion rate vs review rate | contradiction gate; per-source halt conditions; corroboration requires *independent publishers*, not documents |
| R3 | **Silent conflation** — one concept is really two | high, **silent** | mastery anomalies; late | split is first-class; usage context recorded on every reference |
| R4 | Silent duplication — two concepts are really one | high, silent | scheduled similarity report | aliases, dedupe stage, merge queue, standing duplicate metric |
| R5 | **Prerequisite misclassified as reinforcement** (or reverse) | high | learners blocked, or taught out of order | V8 forces explicit classification and always surfaces it to a human |
| R6 | Extractor produces grounded-looking nonsense | high | golden set | quote containment is machine-checked, never model-judged |
| R7 | **Teaching assets install misconceptions** — a bad analogy | high | efficacy data, late | mandatory breakdown point; trust ladder applies to assets; efficacy measured |
| R8 | Copyright | terminal | – | text written not copied; quotes confined to provenance and never served; per-source licence; legal review gates launch |
| R9 | DPDP / minors | terminal | – | separate observation store; `purgeUser`; legal review gates launch |
| R10 | Uncertain knowledge shown as fact | severe | `no-silent-uncertainty` test | labelling invariant (§19.2), enforced by test |
| R11 | DAG check overreaches into reinforcement edges | medium | reinforcement cycles fail CI | dedicated test asserting cycles there **must not** fail |
| R12 | Grounding does not improve lessons | strategic | 2B vs 2D comparison | falsifiable prediction (§28.1); stop if 2D also shows nothing |

**R2, R5 and R7 are new risks that RFC-1 did not have**, created by RFC-2's own changes — the trust ladder, the graph split, and the teaching layer. A redesign that introduces no new risks has not changed anything.

**R3 is the one to fear.** Silent, compounding, and only visible when mastery behaves inexplicably years later.

---

# 40. Premortem

*It is 2031. Agabi failed.*

**Cause 1 — the platform was finished and the product never was.** Two hundred pages, a beautiful trust ladder, and 600 concepts. Teaching still ran through `defaultOutline` for 95% of topics. *Countermeasure:* 2A is one chapter with a student-visible result; every milestone asks "can a student see this?"

**Cause 2 — the trust ladder became a loophole.** Under coverage pressure, the exam-prep floor was quietly lowered from `OFFICIAL_SOURCE_VERIFIED` to `AUTO_VALIDATED`. Nothing broke visibly. Students learned confidently wrong things and blamed themselves. *Countermeasure:* trust policy per use is code, reviewed and tested; lowering a floor is a diff, not a config change; `no-silent-uncertainty` fails CI if labelling is dropped.

**Cause 3 — silent conflation.** `c_energy` meant two things for years. Mastery transferred where it shouldn't and failed where it should have. By the time anyone noticed, tens of thousands of observations were attached to a distinction nobody had made. *Countermeasure:* split as a designed operation; usage context on every reference; scheduled conflation report looking for concepts whose propositions cluster into disjoint context groups.

**Cause 4 — the teaching layer was never populated.** L4 shipped as schema. Nobody authored misconceptions because knowledge coverage always looked more urgent. Lessons stayed accurate and forgettable, and grounding showed no measurable benefit — which was then read as "the knowledge platform doesn't help." *Countermeasure:* 2D is explicitly scheduled **before** the expensive breadth work in 2F, and §28.1 predicts precisely this outcome so it is not misread.

**Cause 5 — one graph again.** A well-meaning refactor unified the dependency and reinforcement graphs "for simplicity." The DAG check began failing on legitimate reinforcement cycles, so it was disabled. Six months later prerequisites contained cycles and path planning silently produced nonsense. *Countermeasure:* separate modules with an import rule forbidding one from seeing the other, plus a test asserting reinforcement cycles do not fail.

**Cause 6 — legal.** Verbatim NCERT text in a public database; minors' observations without verifiable guardian consent. *Countermeasure:* R8, R9, both gating launch.

**Cause 7 — it was never proven to help.** Nobody measured. Resource allocation became opinion, and the graph lost to features with visible metrics. *Countermeasure:* grounded/asset-supported/ungrounded are recorded per lesson; the comparison is a query, not a study.

---

# 41. Consolidated Data Model

```prisma
// ═══════════ L1 SOURCE ═══════════
model Source {
  id String @id  kind String  title String  publisher String  authority String
  edition String?  publishedAt DateTime?  uri String?
  checksum String @unique  license String  licenseUrl String?
  ingestedAt DateTime @default(now())
}
model SourceChunk {
  id String @id            // sha256(sourceId + locator + normalisedText)
  sourceId String  locator Json  text String  ordinal Int
  @@index([sourceId, ordinal])
}
model Provenance {
  propositionId String  sourceId String  chunkId String
  locator Json  quote String              // verification only. NEVER served.
  extractorVersion String  promptVersion String  modelId String
  extractedAt DateTime
  @@id([propositionId, chunkId])
  @@index([sourceId])
}

// ═══════════ L2 ENTITY ═══════════
model Concept {
  id String @id                    // opaque, immutable
  slug String @unique              // mutable, never an FK target
  name String  kind String @default("ENTITY")
  scope String @default("PUBLIC")
  status String @default("DRAFT")  // DRAFT|ACTIVE|DEPRECATED|MERGED|SPLIT
  version Int @default(1)  supersedes String?
  mergedInto String?  splitInto String[]   // ← ambiguous resolution after split
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

// ─── the two graphs, deliberately separate tables ───
model DependencyEdge {              // REQUIRES only. ACYCLIC. enforced.
  fromId String  toId String
  strength Float @default(1)
  contextId String?
  version Int @default(1)  supersedes String?
  @@id([fromId, toId, version])
  @@index([toId])
}
model ReinforcementEdge {           // cycles LEGAL and expected
  fromId String  toId String
  type String     // ENABLES|REINFORCES|REVISITS|TRANSFER_TO|CO_OCCURS
                  // |COMMON_CONFUSION|ANALOGOUS_TO|CONTRASTS|SUCCEEDS
  strength Float @default(1)
  earned Boolean @default(false)    // true = derived from observation, not authored
  contextId String?
  version Int @default(1)
  @@id([fromId, toId, type, version])
  @@index([toId, type])
}

// ═══════════ L3 ASSERTION ═══════════
model ContextDimension {            // OPEN REGISTRY — adding one is an insert
  key String @id  valueType String  values String[]
  specificity Int  since String
}
model Context {
  id String @id                     // hash of its dimension set
  dimensions Json                   // { jurisdiction: "IN", physicsRegime: "newtonian" }
  @@index([dimensions], type: Gin)
}
model Proposition {
  id String @id
  kind String                       // FACT|PROCEDURE|PRINCIPLE|... (registry)
  scope String @default("PUBLIC")
  form String                       // SPO|CONDITIONAL|QUANTIFIED|CAUSAL|COMPARATIVE
                                    // |PROBABILISTIC|DEFINITIONAL
  structure Json                    // form-specific. SPO is ONE case, not the shape.
  subjectId String?                 // denormalised SPO index where form=SPO
  predicate String?
  objectId String?
  text String                       // WRITTEN, not copied
  payload Json
  contextId String
  // trust
  trustLevel String @default("MACHINE_PROPOSED")
  validationMethods String[]
  corroborationCount Int @default(0)
  independentSourceCount Int @default(0)
  derivedFrom String[]              // inference chain, if derived
  authority String?
  evidenceLevel String?
  version Int @default(1)  supersedes String?
  createdAt DateTime @default(now())
  @@index([subjectId, trustLevel])
  @@index([contextId])
  @@index([predicate, objectId])
}
model Contradiction {
  id String @id  aId String  bId String  contextOverlap Json
  status String     // OPEN|RESOLVED|COEXIST
  detectedAt DateTime  resolvedBy String?
  @@index([aId])  @@index([bId])
}

// ═══════════ L4 TEACHING ═══════════
model TeachingAsset {
  id String @id
  kind String                       // MISCONCEPTION|ANALOGY|WORKED_EXAMPLE|... (registry)
  conceptId String  propositionId String?
  payload Json                      // ANALOGY MUST carry breakdownPoint (V14)
  contextId String
  trustLevel String @default("MACHINE_PROPOSED")
  version Int @default(1)  supersedes String?
  scope String @default("PUBLIC")
  @@index([conceptId, kind, trustLevel])
}
model AssetEfficacy {               // DERIVED from observations. never authored.
  assetId String  contextId String
  exposures Int  subsequentSuccess Int  computedAt DateTime
  @@id([assetId, contextId])
}

// ═══════════ L5 PROGRAM ═══════════
model Program {
  id String @id  slug String @unique  name String
  kind String        // SCHOOL_BOARD|DEGREE|CERTIFICATION|EXAM|COURSE|INTERNAL
  authority String  jurisdiction String?
  scope String @default("PUBLIC")  version String
}
model ProgramNode {
  id String @id  programId String  parentId String?
  nodeKind String    // DOMAIN|TRACK|LEVEL|MODULE|UNIT|TOPIC|ROTATION|GRADE|PAPER
  name String  ordinal Int  code String?
  @@index([programId, parentId, ordinal])
}
model Mapping {
  programNodeId String  conceptId String
  depth String       // INTRODUCE|DEVELOP|MASTER|REVISE|ASSUMED
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

// ═══════════ ASSESSMENT ═══════════
model AssessmentItem {
  id String @id  kind String  scope String @default("PUBLIC")
  prompt String  payload Json     // distractors carry diagnosesMisconception
  contextId String  trustLevel String @default("MACHINE_PROPOSED")
  version Int @default(1)  supersedes String?
}
model ItemConcept {
  itemId String  conceptId String  role String  bloom String?
  @@id([itemId, conceptId])
}

// ═══════════ GOVERNANCE ═══════════
model ReviewEvent {
  id String @id  targetKind String  targetId String
  decision String    // APPROVE|REJECT|EDIT|MERGE|SPLIT|DISPUTE|PROMOTE|DEMOTE
  fromTrust String?  toTrust String?
  actorId String     // a human. always.
  before Json?  after Json?  reason String?  batchId String?
  createdAt DateTime @default(now())
  @@index([targetKind, targetId])
  @@index([actorId])                // reputation
}
model Release       { id String @id  label String  createdAt DateTime  frozen Boolean }
model ReleaseMember { releaseId String  kind String  entityId String  @@id([releaseId, kind, entityId]) }
model ClosureCache  { conceptId String  releaseId String  closure Json  computedAt DateTime
                      @@id([conceptId, releaseId]) }

// ═══════════ L6 OBSERVATION — SEPARATE DATABASE ═══════════
model Observation {
  id String @id
  learnerId String
  taskId String?
  conceptIds String[]
  contextId String                  // REQUIRED — makes future splits resolvable
  outcome Json                      // response, correctness, partial, latency
  bloomLevel String?
  assetIds String[]                 // which teaching assets preceded this
  releaseId String                  // which graph version was in force
  occurredAt DateTime
  @@index([learnerId, occurredAt])
  @@index([conceptIds], type: Gin)
}
// NO ConceptMastery table. Mastery is a query (§25.2).
```

## 41.1 What is deliberately absent

| Absent | Section |
|---|---|
| `difficulty` anywhere | §14.4 — a relation, not a property |
| `ConceptMastery` with a score | §25.2 — a conclusion |
| `subject` on `Concept` | §3.2 — a tag |
| `chapter` on `Concept` | §3.3 — pagination |
| any `curriculumId` FK on knowledge | G1 |
| a single `Edge` table | §15/§16 — the two graphs must not merge |
| a `verified: boolean` | §19 — trust has levels |
| `quality` on `TeachingAsset` | §21.1 — efficacy is observed |
| any `DELETE` path | §2.5 |

---

*End of RFC-2.*
