# Part IV — Curriculum, Source, Validation, Review

---

# 21. Curriculum Layer — the Learning Program Graph 🔒

## 21.1 The rejection of Board → Class → Chapter

**ADR-5 — Generic programs, not school hierarchy**

*Context.* The obvious model is `Board → Class → Subject → Chapter → Section`. It is what every K-12 product uses.

*Decision.* Rejected. A generic **Learning Program** tree whose node kinds are *data*.

*Rationale.* "Board" has no meaning for MBBS, ABRSM Grade 5 Piano, or AWS Solutions Architect. "Class" has no meaning for a certification. "Chapter" has no meaning for a clinical rotation. Encoding these as columns means every non-school program stores nonsense in fields named for schools, and every query must know which flavour it is reading.

*Alternatives.* (a) Keep board/class and add a `type` discriminator — rejected: the columns still lie for most rows. (b) Flat tags only — rejected: loses ordering and containment, so "what comes next" is unanswerable. (c) Generic nested tree with declared node kinds — **chosen**.

*Consequences.* Slightly more indirection to answer "which chapter is this in". Accepted, because "chapter" was never fundamental (§3.3).

## 21.2 Schema

```prisma
model Program {
  id        String @id
  slug      String @unique          // "cbse", "mbbs-in", "abrsm-piano", "aws-saa-c03"
  name      String
  kind      String                  // SCHOOL_BOARD|DEGREE|CERTIFICATION|EXAM|COURSE|INTERNAL
  authority String                  // issuing body — CBSE, MCI, ABRSM, Amazon
  jurisdiction String?              // where this program is recognised
  scope     String @default("PUBLIC")
  version   String                  // "2023-syllabus", "C03"
}

model ProgramNode {
  id        String  @id
  programId String
  parentId  String?
  nodeKind  String                  // DOMAIN|TRACK|LEVEL|MODULE|UNIT|TOPIC|ROTATION|GRADE|PAPER
  name      String
  ordinal   Int
  code      String?                 // official code: "Ch-6", "SAA-C03-2.1"
  @@index([programId, parentId, ordinal])
}

model Mapping {                     // THE join that makes CBSE a dataset
  programNodeId String
  conceptId     String
  depth         String              // INTRODUCE|DEVELOP|MASTER|REVISE|ASSUMED
  ordinal       Int
  examWeight    Float?
  required      Boolean @default(true)
  @@id([programNodeId, conceptId])
  @@index([conceptId])              // "which programs teach this?"
}
```

`nodeKind` is a **registry value**, not an enum in code. Adding `ROTATION` for MBBS is a data insert.

## 21.3 Five programs, one schema

```
CBSE                 Program(kind=SCHOOL_BOARD, authority=CBSE, jurisdiction=IN)
  └ DOMAIN Science
     └ LEVEL Class 10
        └ MODULE Life Processes            code "Ch-6"
           └ UNIT Nutrition
              └ TOPIC Photosynthesis  ──▶ Mapping → 30 concepts, depth=DEVELOP

MBBS                 Program(kind=DEGREE, authority=NMC, jurisdiction=IN)
  └ DOMAIN Physiology
     └ LEVEL Year 2
        └ MODULE Cardiovascular
           └ ROTATION Clinical Posting ──▶ Mapping → concepts, depth=MASTER

ABRSM Piano          Program(kind=CERTIFICATION, authority=ABRSM, jurisdiction=null)
  └ DOMAIN Piano
     └ GRADE Grade 5
        └ MODULE Scales ────────────────▶ Mapping → SKILL concepts

AWS SAA-C03          Program(kind=CERTIFICATION, authority=Amazon)
  └ DOMAIN Networking
     └ MODULE VPC
        └ UNIT Route Tables ────────────▶ Mapping → concepts

JEE Advanced         Program(kind=EXAM, authority=IIT)
  └ PAPER Physics
     └ TOPIC Rotational Motion ─────────▶ Mapping → concepts, examWeight=0.08
```

**Note JEE.** It creates zero concepts. It maps onto concepts CBSE already established, adds `examWeight`, and raises `depth` to `MASTER`. That is the whole point: a student preparing for JEE and a student doing Class 10 boards share knowledge and mastery, and differ only in program intent.

## 21.4 Deleting the curriculum layer

Test G1: `DELETE FROM Mapping; DELETE FROM ProgramNode; DELETE FROM Program;`

The graph is unchanged. Every concept, statement, and edge survives. Search works. Traversal works. `selectPath()` still returns prerequisite-ordered concepts — it simply has no program-specific depth or sequencing to apply.

If this test ever fails, a curriculum assumption has leaked into the knowledge layer.

---

# 22. Source Layer

## 22.1 Sources are first-class, not metadata

```prisma
model Source {
  id          String @id
  kind        String              // BOOK|PDF|HTML|MARKDOWN|DATASET|PAPER|API|VIDEO|AUDIO
  title       String
  publisher   String
  authority   String              // maps to Statement.authority
  edition     String?
  publishedAt DateTime?
  uri         String?
  checksum    String              // content hash — re-ingesting unchanged bytes is a no-op
  license     String              // §41 gate
  licenseUrl  String?
  ingestedAt  DateTime @default(now())
  @@unique([checksum])
}

model SourceChunk {
  id        String @id            // sha256(sourceId + locator + normalisedText)
  sourceId  String
  locator   Json                  // { page, section, paragraph, charRange }
  text      String
  ordinal   Int
  @@index([sourceId, ordinal])
}
```

**Content-addressed chunk ids** are what make re-ingestion a diff (§11.6). A new edition produces identical ids for unchanged passages, so extraction runs only where text actually changed.

## 22.2 Provenance links statements to spans

```prisma
model Provenance {
  statementId      String
  sourceId         String
  chunkId          String
  locator          Json
  quote            String        // VERBATIM. verification only. NEVER served (§41).
  extractorVersion String
  promptVersion    String
  modelId          String
  extractedAt      DateTime
  @@id([statementId, chunkId])
  @@index([sourceId])
}
```

A statement MAY have several provenance rows — the same fact appearing in NCERT, in a paper, and in a government syllabus is *stronger*, not duplicated. Multiple independent sources is a confidence signal available for free.

---

# 23. Validation Layer

*Everything machine-decidable, executed before a human is involved.*

## 23.1 The gates, in order

| # | Gate | Check | On failure |
|---|---|---|---|
| V1 | Schema | `accept(advice, RawProposalSchema)` | discard batch, log, alert if rate high |
| V2 | Payload | registry schema for `kind` | discard proposal |
| V3 | **Grounding** | `normalise(chunk.text).includes(normalise(quote))` | **discard — the critical gate** |
| V4 | Quote length | 10 ≤ len ≤ 500 chars | discard |
| V5 | Predicate | in controlled vocabulary (§15.4) | flag as vocabulary-extension request |
| V6 | Concept refs | resolvable, or flagged as new entity | flag |
| V7 | Text originality | `text` is not a substring of `quote` | **flag — copyright (§41)** |
| V8 | Cycle | proposed `REQUIRES` does not close a cycle | reject edge, show cycle |
| V9 | Duplicate | similarity below threshold | route to merge queue |
| V10 | Context validity | `validFrom < validUntil`; jurisdiction is ISO | discard |
| V11 | Self-reference | `subjectId ≠ objectId` | discard |
| V12 | Scope | tenant proposals cannot reference other tenants | discard, security alert |

## 23.2 V3 — grounding, in detail 🔒

The single most important check in the platform.

```ts
export function validateGrounding(quote: string, chunk: SourceChunk): GroundingResult {
  const n = (s: string) => s.normalize("NFC")
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/\s+/g, " ").trim().toLowerCase();
  const hay = n(chunk.text), needle = n(quote);
  if (needle.length < 10)  return { ok: false, reason: "QUOTE_TOO_SHORT" };
  if (!hay.includes(needle)) return { ok: false, reason: "QUOTE_NOT_IN_SOURCE" };
  return { ok: true, charRange: [hay.indexOf(needle), hay.indexOf(needle) + needle.length] };
}
```

Deliberately **not fuzzy**. A model that paraphrases while claiming to quote is doing the exact thing this gate exists to catch. Exact containment after normalisation, or rejection.

This is also what makes the review UI possible: the returned `charRange` lets the reviewer see the quote highlighted *in the passage*, which is what makes batch review fast (§36).

## 23.3 V7 — originality 🔒

If `statement.text` appears verbatim inside `quote`, the extractor copied the textbook. That is reproduction of copyrighted expression (§41).

Flagged, not auto-rejected: for very short factual sentences (*"Water is H₂O"*) there may be no other way to say it, and short factual statements are not protectable. The reviewer decides, and the decision is recorded.

---

# 24. Review Layer 🔒

## 24.1 The status machine

```
        ┌──────────────────────────────────────────┐
        │                                          ▼
DRAFT ──▶ PROPOSED ──▶ VERIFIED ──▶ DISPUTED ──▶ VERIFIED
             │            │              │
             ▼            ▼              ▼
          REJECTED   DEPRECATED      RETRACTED
             │            ▲
             │            │
             └── MERGED ──┘   (tombstone → mergedInto)
```

| State | Teachable | Meaning |
|---|:-:|---|
| `DRAFT` | no | authoring in progress |
| `PROPOSED` | **no** | extracted, machine-validated, awaiting a human |
| `VERIFIED` | **yes** | a human confirmed it against the source |
| `DISPUTED` | no | a conflict was raised; teaching suspended pending resolution |
| `DEPRECATED` | no | superseded by a newer version; readable forever |
| `RETRACTED` | no | affirmatively wrong; readable, marked |
| `REJECTED` | no | never entered; kept as extractor training data |
| `MERGED` | no | tombstone; resolves to `mergedInto` |

## 24.2 The single door 🔒

**ADR-6 — Only a human review event produces VERIFIED**

*Decision.* `VERIFIED` is reachable exclusively through `applyReview()` with a `ReviewEvent` carrying a human `actorId`. There is no other write path, no confidence threshold, no auto-approval flag, no admin override.

*Rationale.* §5.4: under backlog pressure, auto-approval will be introduced "temporarily", and the model silently becomes the source of truth wearing a database costume — with the added harm that its output now carries verification's authority. The only durable defence is architectural.

*Enforcement.* A test asserts that no code path outside `applyReview` writes `status = VERIFIED`, using the same source-walking technique as `architecture.test.ts`.

*Consequences.* Bulk approval is supported and encouraged — approving a 12-item batch is one action — but a human is the actor and the audit records who. Throughput is solved by making review *fast* (§36), never by removing the human.

## 24.3 Review events are permanent evidence

```prisma
model ReviewEvent {
  id         String   @id
  targetKind String                // CONCEPT|STATEMENT|EDGE|ITEM|MERGE
  targetId   String
  decision   String                // APPROVE|REJECT|EDIT|MERGE|DISPUTE|DEPRECATE|RETRACT
  actorId    String                // a human. never a model.
  before     Json?
  after      Json?
  reason     String?
  batchId    String?
  createdAt  DateTime @default(now())
  @@index([targetKind, targetId])
  @@index([batchId])
}
```

Append-only. Never updated, never deleted.

Three uses, all load-bearing:
1. **Audit** — who verified this, when, on what basis.
2. **Extractor evaluation** — approve/reject/edit ratios per extractor and prompt version. "v2 is better" becomes measurable.
3. **Training data** — a thousand human edits is precisely the corpus for improving extraction.

## 24.4 Disputes

Any reviewer may raise `DISPUTE` on a `VERIFIED` statement. It becomes non-teachable immediately and enters the queue with the dispute reason attached. Resolution is `APPROVE` (restore), `EDIT` (new version), or `RETRACT`.

This is the mechanism that makes verification revisable rather than permanent, answering the "verified-but-wrong" half of §4.2.

---

*End of Part IV. Part V — Access (§25–26, 32–34) follows.*
