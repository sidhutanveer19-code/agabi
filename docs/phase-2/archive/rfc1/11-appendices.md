# Appendices

---

# Appendix A — Worked example: photosynthesis, end to end

## A.1 Source

```
Source  { id: src_ncert_sci10_2023, kind: BOOK, publisher: "NCERT",
          title: "Science — Class X", edition: "2023",
          authority: "NCERT", license: "©NCERT — download permitted, reproduction restricted",
          checksum: sha256(bytes) }

SourceChunk { id: sha256(src + locator + text),
              locator: { page: 98, section: "6.2", paragraph: 3 },
              text: "Green plants use sunlight to prepare their own food. This process
                     is called photosynthesis. During this process chlorophyll absorbs
                     light energy, which is used to convert carbon dioxide and water
                     into carbohydrates, releasing oxygen." }
```

## A.2 Extraction (untrusted)

```jsonc
// Advice<RawProposal[]> — unusable until accept()
[
  { "kind": "FACT",
    "quote": "chlorophyll absorbs light energy",           // ✅ V3 passes
    "conceptNames": ["Chlorophyll", "Light energy"],
    "subject": "Chlorophyll", "predicate": "consumes", "object": "Light energy",
    "text": "Chlorophyll absorbs light energy.",           // WRITTEN, not copied → V7 flags
    "payload": { "statement": "…", "misconceptions": ["chlorophyll produces light"] },
    "locator": { "page": 98, "section": "6.2" } },

  { "kind": "FACT",
    "quote": "convert carbon dioxide and water into carbohydrates, releasing oxygen",
    "conceptNames": ["Photosynthesis","Carbon dioxide","Water","Carbohydrate","Oxygen"],
    "subject": "Photosynthesis", "predicate": "produces", "object": "Carbohydrate",
    "text": "Photosynthesis produces carbohydrates from carbon dioxide and water.",
    "prerequisiteNames": ["Chlorophyll","Light energy"] },

  { "kind": "FACT",
    "quote": "photosynthesis releases nitrogen",           // ❌ NOT IN SOURCE
    "text": "Photosynthesis releases nitrogen." }          //    V3 auto-rejects.
]                                                          //    Zero human time spent.
```

The third proposal is a hallucination with a fabricated quote. It never reaches a human — §23.2 is the whole defence.

## A.3 After review

```
Concept c_7f2  slug: chlorophyll     name: "Chlorophyll"     VERIFIED
Concept c_8a1  slug: light-energy    name: "Light energy"    VERIFIED
Concept c_9c4  slug: photosynthesis  name: "Photosynthesis"  VERIFIED

Context ctx_universal { all null, language: "en" }

Statement s_a12  subject c_7f2 · predicate consumes · object c_8a1
                 text "Chlorophyll absorbs light energy."
                 context ctx_universal · authority NCERT · confidence VERIFIED
                 provenance → src_ncert_sci10_2023 p.98 §6.2
                              quote "chlorophyll absorbs light energy"

Edge c_9c4 ──REQUIRES──▶ c_7f2
Edge c_9c4 ──REQUIRES──▶ c_8a1

Tags   c_9c4 { subject:Biology, subject:Chemistry, topic:Life Processes, bloom:understand }
Alias  c_7f2 { "chlorophyll pigment", "पर्णहरित"(hi) }

Mapping  ProgramNode(CBSE ▸ Science ▸ Class 10 ▸ Life Processes ▸ Nutrition)
         → c_9c4  depth: DEVELOP  ordinal: 3
```

Note `subject:Biology` **and** `subject:Chemistry` on the same concept — impossible if subject were identity (§3.2).

## A.4 Teaching

```
"photosynthesis"
  → resolve         → [c_9c4] (rung 1, exact slug)
  → closure         → [c_7f2, c_8a1, c_9c4]           topologically ordered
  → selectPath      → PREREQUISITE: c_7f2, c_8a1
                      CORE:         c_9c4
  → statementsFor   → ctx {program: CBSE, level: class-10, language: en, at: now}
                      s_a12 (specificity 0, universal — no more specific candidate)
  → outlineFrom     → OutlineSlot[] with real intents
  → repairOutline   → UNCHANGED CODE: heading bookend, 3-visual floor, max text run
  → buildSkeleton   → instant shells
  → fillChunk       → model RENDERS the given statements
  → stream
```

Evidence recorded: `grounded: true`, `concepts: [c_7f2@1, c_8a1@1, c_9c4@1]`, `release: 2026-08-01-01`.

---

# Appendix B — Worked example: contract law across jurisdictions

*The case that justifies §16.*

```
Concept c_con  slug: consideration-contract-law
               name: "Consideration"     kind: ENTITY     VERIFIED

Context ctx_in  { jurisdiction: "IN", language: "en" }
Context ctx_gb  { jurisdiction: "GB", language: "en" }
Context ctx_fr  { jurisdiction: "FR", language: "en" }

Statement s_1  subject c_con · predicate requires · object c_valid_contract
               text "A valid contract requires consideration."
               context ctx_in · authority "Indian Contract Act 1872 s.25" · VERIFIED

Statement s_2  (same SPO)
               text "A valid contract requires consideration."
               context ctx_gb · authority "English common law" · VERIFIED

Statement s_3  subject c_con · predicate requires · object c_valid_contract  → NEGATED
               text "A valid contract does not require consideration; cause suffices."
               context ctx_fr · authority "Code civil art.1128" · VERIFIED
```

**Contradiction detection does not fire.** Same subject, same predicate, different object — but the contexts do **not overlap** (§15.5). Three jurisdictions, three truths, one concept, zero duplication.

A Delhi law student gets `s_1`. A comparative-law student passes a context with no jurisdiction and receives all three, and the *contrast is the lesson*.

Under a per-jurisdiction-concept model this needs three concepts, three prerequisite sets, and no mastery transfer for the substantial parts that are identical across all three systems.

---

# Appendix C — Worked example: a piano skill

*The case that justifies `performable` (§17).*

```
Concept c_vib  slug: vibrato-piano   name: "Vibrato"   kind: SKILL   VERIFIED

payload SkillPayload {
  description: "Controlled oscillation of pitch to add warmth and expression.",
  components: ["wrist relaxation", "consistent oscillation rate", "pitch-centre control"],
  rubric: [
    { criterion: "pitch centre", weak: "drifts below", adequate: "mostly centred",
      strong: "consistently centred", weight: 0.3 },
    { criterion: "evenness",     weak: "irregular",   adequate: "mostly even",
      strong: "even throughout",   weight: 0.3 },
    { criterion: "musical use",  weak: "constant/undifferentiated",
      adequate: "varied", strong: "shaped to the phrase", weight: 0.4 }
  ],
  exemplars: [ { quality: "weak", artifact: "audio:…", commentary: "…" } ],
  practiceTasks: [ { prompt: "Sustain a single note, vibrato entering after two beats." } ],
  feedbackDimensions: ["relaxation", "rate", "amplitude", "musicality"]
}

capabilities: [performable, rubric_scored]

Edge c_vib ──REQUIRES──▶ c_hand_position
Edge c_vib ──REQUIRES──▶ c_sustained_tone

Mapping  ProgramNode(ABRSM ▸ Piano ▸ Grade 5 ▸ Technique) → c_vib  depth: DEVELOP
```

No propositional statement is true or false here. There is no fact to verify. The knowledge is a **capability with quality criteria** — and the platform holds it in the same tables, traverses it with the same engine, and maps it with the same curriculum layer as photosynthesis.

The Teaching Engine asks *"is this `performable`?"* and never *"is this music?"* (§13.2).

---

# Appendix D — Consolidated Prisma schema

```prisma
// ─────────── L2 ENTITY ───────────
model Concept {
  id         String   @id
  slug       String   @unique
  name       String
  kind       String   @default("ENTITY")
  scope      String   @default("PUBLIC")
  status     String   @default("DRAFT")
  version    Int      @default(1)
  supersedes String?
  mergedInto String?
  createdAt  DateTime @default(now())
  @@index([status, kind])
  @@index([scope, status])
}

model ConceptAlias {
  conceptId String
  alias     String
  language  String @default("en")
  kind      String @default("SYNONYM")
  @@id([conceptId, alias, language])
  @@index([alias])
}

model ConceptTag {
  conceptId String
  namespace String
  value     String
  @@id([conceptId, namespace, value])
  @@index([namespace, value])
}

model Edge {
  fromId     String
  toId       String
  type       String
  weight     Float   @default(1)
  contextId  String?
  version    Int     @default(1)
  supersedes String?
  @@id([fromId, toId, type, version])
  @@index([toId, type])
}

// ─────────── L3 ASSERTION ───────────
model Context {
  id           String    @id
  jurisdiction String?
  program      String?
  level        String?
  validFrom    DateTime?
  validUntil   DateTime?
  language     String    @default("en")
  audience     String?
  @@unique([jurisdiction, program, level, validFrom, validUntil, language, audience])
}

model Statement {
  id            String   @id
  kind          String
  scope         String   @default("PUBLIC")
  subjectId     String
  predicate     String
  objectId      String?
  objectLit     String?
  text          String
  payload       Json
  contextId     String
  authority     String
  confidence    String   @default("PROPOSED")
  evidenceLevel String?
  version       Int      @default(1)
  supersedes    String?
  createdAt     DateTime @default(now())
  @@index([subjectId, confidence])
  @@index([contextId])
  @@index([predicate, objectId])
}

// ─────────── L1 SOURCE ───────────
model Source {
  id          String   @id
  kind        String
  title       String
  publisher   String
  authority   String
  edition     String?
  publishedAt DateTime?
  uri         String?
  checksum    String   @unique
  license     String
  licenseUrl  String?
  ingestedAt  DateTime @default(now())
}

model SourceChunk {
  id       String @id
  sourceId String
  locator  Json
  text     String
  ordinal  Int
  @@index([sourceId, ordinal])
}

model Provenance {
  statementId      String
  sourceId         String
  chunkId          String
  locator          Json
  quote            String
  extractorVersion String
  promptVersion    String
  modelId          String
  extractedAt      DateTime
  @@id([statementId, chunkId])
  @@index([sourceId])
}

// ─────────── L4 PROGRAM ───────────
model Program {
  id           String  @id
  slug         String  @unique
  name         String
  kind         String
  authority    String
  jurisdiction String?
  scope        String  @default("PUBLIC")
  version      String
}

model ProgramNode {
  id        String  @id
  programId String
  parentId  String?
  nodeKind  String
  name      String
  ordinal   Int
  code      String?
  @@index([programId, parentId, ordinal])
}

model Mapping {
  programNodeId String
  conceptId     String
  depth         String
  ordinal       Int
  examWeight    Float?
  required      Boolean @default(true)
  @@id([programNodeId, conceptId])
  @@index([conceptId])
}

model LearningObjective {
  id            String @id
  programNodeId String
  statement     String
  bloom         String
  ordinal       Int
}

model ObjectiveConcept {
  objectiveId String
  conceptId   String
  role        String
  @@id([objectiveId, conceptId])
}

// ─────────── ASSESSMENT ───────────
model AssessmentItem {
  id         String  @id
  kind       String
  scope      String  @default("PUBLIC")
  prompt     String
  payload    Json
  contextId  String
  status     String  @default("DRAFT")
  version    Int     @default(1)
  supersedes String?
}

model ItemConcept {
  itemId    String
  conceptId String
  role      String
  @@id([itemId, conceptId])
}

// ─────────── GOVERNANCE ───────────
model ReviewEvent {
  id         String   @id
  targetKind String
  targetId   String
  decision   String
  actorId    String
  before     Json?
  after      Json?
  reason     String?
  batchId    String?
  createdAt  DateTime @default(now())
  @@index([targetKind, targetId])
  @@index([batchId])
}

model Release {
  id        String   @id
  label     String
  createdAt DateTime @default(now())
  frozen    Boolean  @default(false)
}

model ReleaseMember {
  releaseId String
  kind      String
  entityId  String
  @@id([releaseId, kind, entityId])
}

model ClosureCache {
  conceptId  String
  edgeType   String
  releaseId  String
  closure    Json
  computedAt DateTime
  @@id([conceptId, edgeType, releaseId])
}

// ─────────── L5 LEARNING (shape only — Phase 3) ───────────
model ConceptMastery {
  // No score column. Mastery is DERIVED from evidence. This is a key, not a truth.
  userId      String
  conceptId   String
  firstSeenAt DateTime @default(now())
  @@id([userId, conceptId])
}
```

---

# Appendix E — Glossary

| Term | Meaning |
|---|---|
| **Concept** | a stable, identified referent that can be known about. Carries no claim. |
| **Statement** | a versioned, contextual, sourced assertion relating concepts. |
| **Context** | the conditions (jurisdiction, program, level, time, language, audience) under which a statement holds. |
| **Edge** | a typed relationship between concepts. |
| **Program** | any structured learning pathway — board, degree, certification, exam, course. |
| **Mapping** | a link from a program node to a concept, with depth and weight. |
| **Provenance** | where a statement came from and which machinery proposed it. |
| **Authority** | who says so. Distinct from correctness (§3.4). |
| **Confidence** | the verification state of a statement. |
| **Release** | an immutable pinned set of entity versions. |
| **Grounded** | a lesson built from verified statements rather than model invention. |
| **`knowledge.miss`** | an event recording a topic the graph could not serve. Drives review priority. |
| **Golden set** | a hand-authored chapter used to score extraction quality. |
| **Tombstone** | a merged entity whose id still resolves to its target. |
| **Capability** | a declared property of a knowledge type that consumers switch on instead of `kind`. |

---

# Appendix F — Decision record index

| ADR | Decision | Section | Confidence |
|---|---|---|---|
| ADR-1 | `knowledge/` is a peer of `conversation/` | §8.3 | ⚖️ |
| ADR-2 | All persistence behind `KnowledgeStore` | §10.2 | 🔒 |
| ADR-3 | Knowledge types are registry entries, not schema | §13.1 | 🔒 |
| ADR-4 | No difficulty column; difficulty is derived | §14.4 | 🔒 |
| ADR-5 | Generic Learning Programs, not board/class/chapter | §21.1 | 🔒 |
| ADR-6 | Only a human review event produces `VERIFIED` | §24.2 | 🔒 |
| ADR-7 | No public HTTP knowledge API in Phase 2 | §32.1 | ⚖️ |
| ADR-8 | Identity is opaque, immutable, meaningless | §29.1 | 🔒 |
| ADR-9 | Correction creates a version; never mutates | §27.1 | 🔒 |
| ADR-10 | PostgreSQL canonical; derived indexes on measurement | §30.4 | ⚖️ |

## The five decisions that can never be reversed

1. **§29** — opaque identity
2. **§27** — immutable versioning
3. **§28** — mandatory provenance
4. **§16** — contextual truth
5. **§14/§15** — concept/statement separation

Everything else in this document can be rebuilt.

## The three assumptions most likely to be wrong

1. **§36.1 review throughput** — ~200 statements/hour is an estimate. Measure in 2A.
2. **§11.4 single-pass extraction** — may need splitting into entity/statement/relationship passes.
3. **§19 assessment shapes** — authored with zero response data; expect revision.

All three are marked 🔬 and all three are measured by the end of Phase 2A.

---

*End of specification.*
