# Part I — Foundations

---

# 1. Vision

## 1.1 The one-sentence version

**Agabi should know things, and teaching should be the act of selecting what it knows for a particular learner — not the act of asking a language model to invent a curriculum.**

Everything in this document follows from that sentence.

## 1.2 What exists today, precisely

This is not a greenfield design. The following is the literal behaviour of the system as committed, and the specification must be read against it.

A student types `"photosynthesis"`. The following happens:

1. `POST /api/canvas/{canvasId}/teach` authenticates, rate-limits, and streams.
2. `manager.run()` calls `classifyIntent(text)` — a model call, wrapped as `Advice<T>`, validated by `accept()`.
3. `resolveAction()` — a pure function — maps the validated intent to `{ kind: "StartLesson", topic: "photosynthesis" }`.
4. `startLesson()` calls `repairOutline(defaultOutline(topic), topic)`.
5. `defaultOutline(topic)` is **pure string templating**. Its entire knowledge of photosynthesis is the nine-element array:

   ```
   heading    → "photosynthesis"
   paragraph  → "what photosynthesis is and why it matters"
   <visual>   → "the core structure of photosynthesis"
   paragraph  → "explain the main idea of photosynthesis"
   ...
   ```

6. `buildSkeleton()` renders those nine shells instantly.
7. `fillChunk()` — a model call — fills them.
8. `coerceSlot()` repairs whatever comes back; `adaptBlock()` validates it; the block streams to the canvas.

Read step 5 again. **The system's knowledge of photosynthesis is the word "photosynthesis".** Everything a student learns comes from the weights of a free-tier language model, selected at request time from a fallback chain, unversioned, unattributed, and unverifiable. If it is wrong, nothing detects it. If it is right, nothing records why.

The Phase 1 architecture is genuinely excellent at what it does. `Advice<T>` makes it impossible for raw model output to reach `createLesson()` — not discouraged, impossible, enforced by the type system and by `architecture.test.ts` walking the import graph. Deterministic code owns every state transition. A model cannot advance a cursor, switch a lesson, or write to the database.

And yet a model can teach a fifteen-year-old that photosynthesis releases carbon dioxide, and the architecture will faithfully, deterministically, auditably deliver that to the canvas.

**Phase 1 secured the machinery and left the cargo unguarded.**

## 1.3 What Phase 2 changes

One sentence in `manager.ts` changes:

```ts
// before
const { outline } = repairOutline(defaultOutline(topic), topic);

// after
const concepts = await selectPath(resolved, learnerContext, objective);
const { outline } = repairOutline(outlineFrom(concepts), topic);
```

Everything else in the teaching path — `repairOutline`, `buildSkeleton`, `coerceSlot`, `adaptBlock`, the fill ladder, every renderer, the visual guarantee, skeleton-first rendering — is untouched. That is deliberate and it is the measure of whether this design is correct. **A knowledge platform that requires rewriting the teaching engine has failed its integration test before it is built.**

Behind that one line sits everything this document specifies.

## 1.4 The scope that the architecture must survive

Agabi is not a CBSE product that might later expand. It is a knowledge platform whose first dataset is CBSE. The distinction is not rhetorical — it determines the schema.

The platform must hold, without redesign:

| Domain | What it stresses in the model |
|---|---|
| CBSE / ICSE / State Boards / IB / IGCSE | Multiple curricula asserting different depths of the same truth |
| JEE / NEET / UPSC / IPMAT / CAT / GMAT / SAT | Exam-scoped emphasis and weighting over shared concepts |
| MBBS, clinical medicine | Time-versioned guidelines; evidence levels; contraindications; diagnostic reasoning |
| Law | **Jurisdictionally contradictory truth**; precedent and authority hierarchies |
| Engineering | Regional standards and codes; tolerance and applicability conditions |
| Programming | Executable artifacts; version-scoped truth (a Python 2 fact is false in Python 3) |
| Languages | Skill acquisition without propositional content; L1-dependent difficulty |
| Music | Embodied performance; assessment by demonstration, not by answer |
| Corporate training | Private, tenant-scoped knowledge alongside public knowledge |

Each row above breaks at least one naive design. Law breaks "a fact is true." Medicine breaks "a fact is true *now*." Music breaks "knowledge is propositional." Programming breaks "knowledge is stable." Corporate training breaks "the graph is public."

The model in Part III is designed against all nine simultaneously, because a model designed against one and extended to the rest becomes the technical debt this phase exists to prevent.

## 1.5 The perfect outcome

Ten years from now, a maintainer should be able to:

- Ask *"what does Agabi know about consideration in contract law, and who says so?"* and get statements scoped by jurisdiction, each traced to an authority, each with a validity window.
- Ask *"what did student X actually see in their photosynthesis lesson on 4 August 2026?"* and replay it exactly, including which concept versions and which graph release were in force.
- Add ICSE by inserting mapping rows, creating **zero** new concepts.
- Add a new knowledge type (`PRECEDENT`, `PERFORMANCE`, `PROTOCOL`) by adding a registry entry, touching **zero** existing tables.
- Swap the storage engine by changing **one module**, with no change to the logical model.
- Retire a wrong statement without deleting it, and see every lesson that ever used it.

If any of those requires a migration, the corresponding section of this document was wrong.

---

# 2. Philosophy

## 2.1 Knowledge is not documents

A book is not knowledge. A book is one serialisation of knowledge, optimised for linear human reading, constrained by page count, sequenced by pedagogical convention, and frozen at an edition date.

The same is true of a chapter, a PDF, a syllabus, a website, and a lecture. All are **sources**. All are datasets. None is the architecture.

This has a direct consequence that most educational software gets wrong: **the curriculum hierarchy must not be the primary key of the system.** The moment `chapter_id` is a required parent of a concept, the concept belongs to CBSE, and ICSE needs its own copy, and mastery does not transfer, and the platform is a curriculum database wearing a graph's clothes.

Knowledge is atomic entities and the relationships between them. Everything else is a *view*.

## 2.2 Truth is contextual — the deepest commitment in this document

The naive model is:

```
Concept { name, definition }
```

It is wrong, and it is wrong in a way that cannot be repaired later.

**Law.** *"A valid contract requires consideration."* True in India and the UK. False in France, where cause replaces consideration. Same concept. Opposite truth. Both correct.

**Medicine.** *"First-line treatment for uncomplicated hypertension is a thiazide diuretic."* Reasonable in 2018 under JNC-8. Superseded by 2022 guidance. Not wrong then; wrong now. The 2018 statement must remain readable, because a lesson taught in 2018 must remain reconstructable.

**Programming.** *"`print` is a statement."* True in Python 2. False in Python 3.

**Education itself.** *"An atom's electrons orbit the nucleus in shells."* This is what CBSE Class 10 teaches. It is also a deliberate simplification that a physics degree will contradict. Both are legitimate statements at their level. A platform that must choose one has to lie to somebody.

Therefore:

> **A concept is a stable identity. A statement is a contextual assertion about concepts. The graph stores every validated statement. The teaching layer selects which one applies to this learner, in this program, in this jurisdiction, at this time.**

Truth is not globally unique. Pretending otherwise is the single assumption that, left unchallenged, forces a rewrite in year three.

## 2.3 The model is an advisor — extended to knowledge

Phase 1 established: *no model may change application state; every model is an advisor; the backend is the decision maker.*

Phase 2 extends the identical rule one layer down: **no model may establish knowledge.** A model may *propose* a concept, *propose* a statement, *propose* a relationship. Nothing it proposes is true until a human verifies it against a source.

This is not a new trust boundary. It is the existing one, and the existing machinery implements it exactly:

- The extractor is a model call, so it lives under `src/server/advisors/` — enforced by `architecture.test.ts`, which forbids any file outside `advisors/` from importing an AI SDK, with **no `import type` exemption**.
- It returns `Advice<RawConcept[]>` — an opaque branded type whose only exit is `accept(advice, schema)`.
- `createConcept()` accepts plain validated values, never `Advice<T>`. Raw extraction output **fails to compile** if passed to it.

The wall that stops a model corrupting a cursor is the same wall that stops a model asserting a fact. Nothing new is invented; the existing invariant is simply pointed at a new target.

## 2.4 Evidence over conclusions

Inherited directly from the observability work in flight: **store evidence, never store conclusions.**

A conclusion is anything that can be recomputed. A ratio, a score, a difficulty rating, a mastery estimate, a recommendation. Store the inputs; derive the output at read time.

The reason is not storage cost. It is that **a formula change must reinterpret history, not invalidate it.** If difficulty is stored as `3`, and next year the difficulty model improves, every historical `3` is now meaningless and unrecomputable. If instead the graph stores prerequisite depth, dependency count, cognitive operation, and observed error rates, then the new model recomputes every historical difficulty correctly and instantly.

This is why §14 stores no `difficulty` column. It is not an oversight.

## 2.5 Nothing is ever deleted

Knowledge is corrected, superseded, deprecated, and disputed. It is never overwritten.

- A corrected statement is a **new version**, with the old one retained and marked superseded.
- A retracted statement is **deprecated**, not removed.
- A merged duplicate leaves a **tombstone** that redirects, so old references still resolve.

The single exception, inherited from Phase 1, is **erasure of personal data** under DPDP/GDPR — `purgeUser`. Knowledge is not personal data; learner evidence is. The two live in different layers precisely so that erasing one never damages the other.

## 2.6 The platform must work with zero content

A platform that only functions once populated cannot be tested, cannot be demonstrated, and cannot be developed in parallel with content.

Every component in Part II must have meaningful behaviour on an empty graph:

- Search returns no results — not an error.
- Traversal returns an empty path — not an error.
- `selectPath()` returns nothing, and the Teaching Engine **falls back to today's `defaultOutline`**, emitting a `knowledge.miss` event.

That last point is load-bearing for the whole project. It means the graph can be adopted **incrementally, one chapter at a time**, with zero regression for topics not yet covered — and the miss events become the prioritised content backlog, driven by what students actually ask for rather than by what a spreadsheet says should be covered first.

---

# 3. First-Principles Analysis

Constructing the model from what is actually necessary, rather than from what educational software conventionally does.

## 3.1 What is irreducibly required to teach something?

Strip away every assumption. To teach, a system must be able to answer:

| # | Question | Implies |
|---|---|---|
| Q1 | What is the thing being learned? | A stable identity for the thing |
| Q2 | What is true about it? | Assertions, separable from identity |
| Q3 | Under what conditions is that true? | Context on assertions |
| Q4 | What must be understood first? | Ordered relationships between identities |
| Q5 | How do we know it is true? | Provenance on assertions |
| Q6 | How would we know the learner has it? | Assessment linked to identity |
| Q7 | What does the learner already have? | Learner state, separate from knowledge |

Seven questions. Nothing else is fundamental. Note what is **absent**: subject, chapter, class, board, page, difficulty, grade level, textbook. Every one of those is organisational convenience, not a requirement of teaching. They are answers to *"where did this come from"* and *"who is it for"*, which are Q5 and Q7 wearing school uniforms.

This directly produces the layering:

```
Q1        → Concept        (identity)
Q2, Q3    → Statement      (contextual assertion)
Q4        → Relationship   (edges between concepts)
Q5        → Provenance     (source, authority, evidence)
Q6        → Assessment     (bound to concepts)
Q7        → Learner state  (Phase 3 — deliberately outside this graph)
```

## 3.2 Is "subject" a universal abstraction?

**No.** Tested by falsification.

Is *"the rate of change of a quantity"* Mathematics or Physics? Is *"osmosis"* Biology or Chemistry? Is *"the economics of the Bengal famine"* History or Economics? Is *"reading a graph"* Mathematics, Geography, or a general skill?

Every answer is defensible, which means the question is malformed. Subject is not a property of knowledge; it is a property of **how an institution has chosen to divide teaching labour**. It varies by board, by country, and by decade.

**Consequence — 🔒 LOAD-BEARING:** `subject` MUST NOT be a column on `Concept`. It is a tag — many-valued, editable, non-identifying. A concept may carry `subject:Biology` and `subject:Chemistry` simultaneously, and a curriculum mapping may assert a different subject again for its own purposes without touching the concept.

Any design that puts subject in the identity (including in an ID string such as `BIO.PHOTO.CHLORENERGY`) is asserting something that will become false.

## 3.3 Are chapters fundamental?

**No.** A chapter is a pagination decision. NCERT's 2023 edition renumbered chapters relative to 2021. The knowledge did not change; the container did.

**Consequence:** the curriculum hierarchy is a *mapping layer*, never a parent of knowledge. A concept has no chapter. A `CurriculumMapping` row says *"program P, at node N, teaches concept C to depth D."* Delete every curriculum in the system and the knowledge graph is unharmed.

## 3.4 Is the textbook correct?

**Not assumable.** Textbooks contain errors, simplifications presented as truth, and outdated claims. NCERT is authoritative *for CBSE examinations* — which is a genuine, useful kind of authority — but it is not authoritative about physical reality.

This forces a distinction the model must carry explicitly:

- **Curricular authority** — "CBSE says this, and the exam will mark it correct."
- **Epistemic authority** — "the current scientific consensus is this."

They usually agree. When they disagree, both must be representable, and the Teaching Engine must be able to choose curricular authority for an exam-preparing student while the platform retains the knowledge that reality differs.

**Consequence:** `authority` is a first-class field on a statement (§15), not a footnote in provenance.

## 3.5 What is the smallest unit of knowledge?

The genuinely hard question, and the one where the interactive design iterated.

Candidate A — **the concept is the sentence.** *"Chlorophyll absorbs light energy"* is a node. Problem: the sentence encodes a claim, so the node is a claim, so a different claim about chlorophyll needs a different node, so context forks identity, so duplication returns.

Candidate B — **the concept is the entity; claims attach to it.** *Chlorophyll*, *Light energy*, and *Photosynthesis* are nodes. *"Chlorophyll absorbs light energy"* is a **statement** linking them: subject `Chlorophyll`, predicate `absorbs`, object `Light energy`.

B is correct, and the argument is decisive: **identity must be stable under changing belief.** Everything we know about chlorophyll may be revised; chlorophyll remains the same referent. A model where a corrected fact creates a new entity cannot accumulate knowledge — it accumulates orphans.

This is the same reason RDF, Wikidata, and every serious knowledge base separate entities from assertions. It is not a stylistic preference; it is what makes knowledge revisable.

**🔒 LOAD-BEARING.** Concepts are entities. Statements are assertions. They are different tables and they can never be merged later.

### 3.5.1 The consequence for granularity

Under Candidate B, "how atomic is a concept?" partly dissolves. Class 10 Biology needs perhaps **3,000 concept entities** (chlorophyll, chloroplast, stroma, glucose, light reaction…) carrying perhaps **10,000 statements**. The statements carry the teaching load; the entities carry identity and relationships.

This is materially better than 13,000 sentence-nodes, because:
- Entities are far more reusable across domains (chlorophyll appears in Class 10, in a botany degree, and in a photosynthesis research paper).
- Statements are cheap to add, revise, and scope — which is exactly what changes over time.
- Prerequisites attach to entities, so the prerequisite graph is stable while beliefs churn.

## 3.6 What is genuinely constrained?

Applying the discipline that only physics is a real constraint:

| Claimed constraint | Real? | Analysis |
|---|---|---|
| Knowledge has prerequisites | **Yes** | Cognitive. You cannot understand a derivative without functions. This is a property of minds, not of curricula. |
| Learning takes time | **Yes** | Physical. Bounds how much a lesson can contain. |
| Forgetting occurs | **Yes** | Physical. Forces spaced repetition eventually — but that is Phase 3. |
| Truth can be context-dependent | **Yes** | Logical. Jurisdiction and time genuinely alter truth value. |
| Human review has finite throughput | **Yes** | The binding constraint on this entire phase. See §4.1. |
| Knowledge is organised into subjects | **No** | Institutional convention. |
| Knowledge is organised into chapters | **No** | Pagination. |
| Curricula are hierarchical | **No** | Presentational. Some are graphs, some are checklists. |
| Difficulty is a property of content | **No** | Difficulty is a *relation* between content and learner. |
| A lesson covers one topic | **No** | Interface convention inherited from books. |

Six of ten conventional assumptions are not constraints. The architecture must not encode them.

## 3.7 The teaching bottleneck, stated precisely

**Applying bottleneck analysis to the whole phase:**

The graph schema is not the bottleneck — it is perhaps two weeks of work.
The extraction pipeline is not the bottleneck — models are good enough at this, and the work is bounded.
The storage engine is not the bottleneck — the access patterns are shallow and well understood.

**Human verification is the bottleneck.** ~68 chapters of Class 10 across nine subjects, at the entity+statement grain, is on the order of 3,000 concepts and 10,000 statements for the first curriculum alone. At any honest review rate, that is between 100 and 250 hours of qualified human attention.

Every design decision in Parts VIII and IX is therefore optimised for **review throughput**, not for schema elegance. Specifically:

- Review happens in **source context**, in batches (§36) — a reviewer reads a passage once and decides eight things, rather than reading eight decontextualised cards.
- Machine-checkable rejections happen **before** a human sees anything (§23): if the supporting quote is not literally present in the source text, the candidate is discarded with zero human cost.
- Review is **ordered by leverage** — concepts with high inbound prerequisite degree first, because an error there propagates.
- Every review decision is **recorded as evidence** (§24), which makes it the training and evaluation set for improving the extractor. A thousand human corrections is precisely the data needed to prove extractor v2 beats v1.

A specification that optimises the schema and ignores review throughput will produce a beautiful, empty graph.

---

# 4. Red-Team Analysis

*Attacking the design before building it. Each attack is stated as an adversary would, then answered.*

## 4.1 Attack: "You will never fill it"

**The attack.** The graph needs thousands of verified statements. One person is verifying them. At 30 seconds each — optimistic — 10,000 statements is 83 hours of unbroken concentration. Realistically 150–250 hours with context switching. The founder also has to build the product, deploy it, get users, and handle a legal review. The graph reaches 400 concepts and stops. Teaching still runs on `defaultOutline`. Two years of architecture, zero improvement to any lesson.

**Assessment: this is the most probable failure mode by a wide margin.** It is not a schema problem and no amount of design elegance addresses it.

**Answer, in four parts:**

1. **Fallback by design.** `selectPath()` returning empty is a normal, supported state — the lesson falls back to `defaultOutline` and emits `knowledge.miss`. The platform never blocks on coverage. A graph with 40 concepts improves 40 concepts' worth of lessons and harms nothing.
2. **Demand-driven ordering.** `knowledge.miss` events say exactly which topics real students requested and the graph could not serve. Review effort follows observed demand, not curriculum order. The first 200 concepts land where students actually are.
3. **Ruthless pre-filtering.** Quote-containment checking, payload validation, and duplicate detection are all machine-decidable and run before any human involvement (§23). Human attention is spent only on judgment.
4. **Milestone forcing function.** Phase 2A is defined as *one chapter, end to end, visible to a student* (§47). If that cannot be achieved in weeks, the plan is falsified early and cheaply.

## 4.2 Attack: "The extractor will produce confident nonsense"

**The attack.** A model reads a chapter and produces a statement that is fluent, plausible, correctly formatted, and false — with a fabricated supporting quote. It passes review because the reviewer is tired and it looks right. Now false knowledge has provenance, a version, and institutional authority. It is *worse* than today, because today's errors are transient and disclaimed, while this error is stamped "verified."

**Assessment: severe.** Verified-but-wrong is more dangerous than unverified.

**Answer:**

1. **Quote containment is machine-checked, never model-judged.** The extractor MUST return the verbatim supporting span. Validation performs literal substring containment against the normalised source chunk. Absent → automatic rejection, no human time consumed. This alone eliminates fabricated support.
2. **Review shows source and candidate side by side**, with the quote highlighted in the passage. The reviewer's task is comparison, not recall.
3. **Golden-set regression** (§44). One chapter is hand-authored as ground truth. Every extractor and prompt change is scored against it. "The extractor improved" becomes a measurement, not an opinion.
4. **Verification is not permanent.** Statements carry `confidence` and can be re-opened. A `DISPUTED` state exists precisely so that a later reader can challenge an earlier approval.

## 4.3 Attack: "Global concepts will fill with near-duplicates"

**The attack.** Global identity is chosen so that ICSE reuses CBSE's concepts. But dedupe is fuzzy. "Chlorophyll" and "Chlorophyll pigment" and "Chlorophyll molecule" all get created by different ingestion runs. By 2029 there are four Newton's Second Laws. Mastery transfers to none of them. Prerequisites point at arbitrary variants. The graph is quietly worthless and no single day is when it broke.

**Assessment: severe, silent, and compounding — the worst combination.**

**Answer:**

1. **Aliases are first-class** (§14). "Chlorophyll pigment" is an alias of `Chlorophyll`, not a sibling. Extraction resolves against aliases before proposing anything new.
2. **Dedupe is a mandatory pipeline stage** (§35), not a cleanup job. A candidate above similarity threshold is presented as a *merge decision*, never auto-created.
3. **Merges are non-destructive** (§27). Merging leaves a tombstone; the losing ID resolves forever. This makes merging safe, which makes reviewers willing to do it.
4. **Standing duplicate report** (§45). A scheduled job surfaces suspiciously similar VERIFIED concepts. Duplicate rate is an operational metric with a threshold, not a hope.

## 4.4 Attack: "Identity will encode meaning and then lie"

**The attack.** Readable IDs like `BIO.PHOTO.CHLORENERGY` are adopted because they are pleasant in review screens. Then chlorophyll turns out to be Physics as well as Biology. Then the 2028 NCERT edition reorganises photosynthesis. Now a million rows carry an identity that asserts something false, and renaming means rewriting every reference, every mapping, every stored lesson.

**Assessment: certain if allowed. This is among the most common and most expensive mistakes in knowledge systems.**

**Answer — 🔒 LOAD-BEARING (§29):** identity is an **opaque, immutable, meaningless** ID. Human readability is provided by a separate **mutable slug** which no foreign key ever references. Classification lives in tags, which are data. The pleasant thing and the permanent thing are different columns.

## 4.5 Attack: "Contextual truth is over-engineering for a Class 10 app"

**The attack.** Jurisdictions, validity windows, authority hierarchies, evidence levels — none of this is needed to teach photosynthesis. It doubles the schema, complicates every query, and slows the first release for benefits that arrive in year five, if ever.

**Assessment: the strongest attack in this section, and it must be answered honestly rather than dismissed.**

**Answer:** the cost asymmetry is decisive, but only because the design keeps the simple case simple.

- With context designed in, school knowledge uses **one unscoped statement per assertion**. The jurisdiction field is null. The validity window is unbounded. The authority is NCERT. Queries that ignore context see exactly the naive model.
- Without it, adding law or medicine later means adding a scope dimension to a table where every existing row is implicitly "global" — but *is* it global? Nobody knows. Was that CBSE-specific simplification universal or curricular? The information was never captured, so it cannot be recovered.

**Retrofitting context is not a schema migration; it is an unanswerable question about every historical row.** The columns cost nothing when unused. Not having them costs everything when needed. This is accepted.

## 4.6 Attack: "Postgres will collapse at 100M concepts"

**The attack.** Recursive CTEs over 100M nodes and billions of edges will not perform. You will discover this at scale, under load, with users, and the migration to a real graph database will require rewriting every query in the system.

**Assessment: partly true and fully mitigable.**

**Answer:**

1. The traversals are **shallow**. Prerequisite closure is single-digit depth by cognitive necessity — a Class 10 concept does not have a 40-hop prerequisite chain. This is the workload relational stores handle well. It is not a social-graph "friends of friends of friends" problem.
2. Prerequisite closures are **cached and invalidated on edge writes** (§31). The hot read path does not traverse at all.
3. **All access is behind one module** (§30). `KnowledgeStore` is an interface; the Postgres implementation is one file. Swapping or adding a traversal engine changes that file and nothing else.
4. 100M concepts is not a near-term reality. It is a *design constraint on the interface*, and the interface is designed for it. The implementation is chosen for the actual data volume, and re-chosen when that changes.

Vendor lock-in is avoided not by picking an exotic store, but by ensuring the logical model never mentions one.

## 4.7 Attack: "Nobody will use it because the Teaching Engine is fine"

**The attack.** Lessons already look good. Grounded lessons will look identical to a student. The graph adds latency, complexity, and failure modes for an invisible benefit, and will quietly be bypassed.

**Assessment: real, and it points at a genuine gap in measurement.**

**Answer:** the benefit must be made **measurable, not asserted**. The Phase-2-Observability evidence spine already provides the instrument. Every lesson records whether it was grounded, which concept versions it used, and its quality outcome. Grounded and ungrounded lessons become directly comparable on error rate, degradation rate, and eventually learning outcomes.

If grounding does not measurably improve lessons, that is a finding, and it should change the plan. A platform that cannot be falsified is not engineering.

## 4.8 Attack: "You are storing copyrighted text"

**The attack.** NCERT books are freely downloadable but not freely reproducible. The graph stores explanations extracted from them. A public product serving that text is straightforward infringement, and the takedown arrives after the platform is load-bearing.

**Assessment: real legal exposure. Facts are not copyrightable; expression is.**

**Answer (§41):**

1. `statement.text` and any explanation MUST be **written**, not copied. Extraction produces a proposal; the reviewer's job includes ensuring the wording is Agabi's.
2. The **verbatim quote is stored only in provenance**, used only for verification, and **never served to a student**. This is quotation for the purpose of accuracy checking, not redistribution.
3. `Source.license` is recorded per document, and connectors refuse ingestion of licence-incompatible sources (§37).
4. This requires the same legal review as the DPDP minor-consent question, and it is a **gate on public launch**, not on development.

## 4.9 Attack: "Assessment authored before a student model exists will be wrong"

**The attack.** Assessment is being built in Phase 2, but mastery is Phase 3. Question shapes, difficulty calibration, and misconception diagnosis are being designed with no learner data. They will be wrong and will need re-authoring across thousands of items.

**Assessment: partly true, and the decision to build assessment now was explicit.**

**Answer, and this section is marked 🔬 PROVISIONAL for exactly this reason:**

1. Assessment items in Phase 2 store **only what is irreplaceable**: the prompt, the correct response, the misconception each distractor targets, and which concepts the item evidences. No difficulty, no discrimination index, no calibration — all of those are derived from response data that does not exist yet.
2. Item **content** is authored once and survives; item **statistics** accumulate later against the same rows.
3. Authoring assessment during chapter review is genuinely cheaper than a second pass, because the reviewer already has the source open. This was the stated rationale and it is sound.
4. §19 explicitly marks its payload shapes as provisional and expects revision after the first real response data.

## 4.10 Attack: "Corporate and private knowledge breaks the public graph"

**The attack.** Corporate training is in scope. A company's internal knowledge cannot be in a shared global graph, but their concepts overlap heavily with public ones. Bolting on tenancy later means adding a tenant column to every table and auditing every query for leaks.

**Assessment: real, and cheap to prevent now.**

**Answer:** every knowledge row carries a **`scope`** discriminator from day one — `PUBLIC` or a tenant identifier. Public knowledge is visible to all; tenant knowledge is visible only within its tenant and may reference public concepts. The default is `PUBLIC` and the field is otherwise inert, but its presence means multi-tenancy is a filter rather than a migration. Same reasoning as §4.5: an unused column is free, a missing one is not.

---

# 5. Premortem

*It is 2031. Agabi failed. The following is the postmortem, written backwards.*

## 5.1 Cause 1 — The platform was finished and the product never was

**Probability: highest.**

The knowledge platform was genuinely excellent. The specification ran to two hundred pages and every decision was defensible. Ingestion worked. Versioning worked. The type registry gracefully accepted new domains.

It held 600 concepts.

Teaching still ran through `defaultOutline` for 95% of topics, because nobody had time to verify the other 12,000. Students never noticed a difference, because for almost everything they asked, there was no difference. Funding ran out during the second year of content work.

**Countermeasures, all specified:** §47 defines Phase 2A as one chapter end to end with a student-visible result. Graceful fallback (§2.6) means partial coverage is a supported state rather than a broken one. `knowledge.miss`-driven prioritisation (§36) ensures the concepts that do exist are the ones students actually hit. The forcing question at every milestone is *"can a student see this?"* — not *"is the schema complete?"*

## 5.2 Cause 2 — Silent duplication destroyed the graph

**Probability: high. Detection: late.**

Global concepts were the right decision. Dedupe was implemented as a similarity threshold and treated as solved. Ingestion ran across boards, editions, and languages. Every run added a few near-duplicates that fell just under threshold.

By 2029 the graph held six variants of Newton's Second Law, each with partial prerequisites and partial mastery. The Mastery Engine reported that students understood a concept they had never been taught, and failed to recognise mastery they had earned. The bug was in the data, so no amount of debugging the code found it.

**Countermeasures:** aliases as first-class objects (§14); dedupe as a mandatory pipeline stage with human merge decisions (§35); non-destructive merges with permanent tombstones (§27); a **standing operational metric** for duplicate rate with an alert threshold (§45). Duplication is treated as an ongoing operational condition, not a one-time correctness problem.

## 5.3 Cause 3 — Identity encoded meaning

**Probability: certain, if not prevented today.**

Readable IDs shipped because they were convenient in the review UI. In 2028, NCERT reorganised, two subjects claimed the same concept, and a Hindi-medium expansion needed different slugs. Every stored lesson, every mapping, every mastery record referenced IDs that now asserted falsehoods. Renaming was impossible; living with it was corrosive.

**Countermeasure:** §29. Opaque immutable ID, mutable slug, classification as tags. Decided, marked load-bearing, and enforced by a test asserting no foreign key references `slug`.

## 5.4 Cause 4 — The extractor was trusted to clear the backlog

**Probability: moderate. Mechanism: entirely social.**

The review queue reached 9,000 items. Auto-approval was introduced "temporarily" for high-confidence extractions. The model became the source of truth wearing a database costume, with the added harm that its output now carried the authority of verification.

**Countermeasure:** `VERIFIED` is reachable **only** through a `ReviewEvent` carrying a human reviewer identity, enforced by a test rather than a policy (§24, §44). Bulk approval is supported — approving a batch is one action — but a human is always the actor, and the audit trail records who.

## 5.5 Cause 5 — Context was omitted as premature

**Probability: moderate, if §4.5 had been accepted.**

Contextual truth was cut from v1 as over-engineering for a Class 10 app. In 2029 Agabi expanded to competitive exams and then to professional certification, and hit the first genuinely contradictory statements. Adding jurisdiction and validity to a table of 400,000 unscoped rows raised a question nobody could answer: *was this row universal, or CBSE-specific?* The information had never been captured. The graph could not be repaired, only re-verified — 400,000 times.

**Countermeasure:** context ships in v1, unused and free for school content (§16).

## 5.6 Cause 6 — Legal

**Probability: low but terminal.**

Verbatim NCERT explanations sat in a public database. A takedown arrived after the platform was load-bearing. Separately, minors' learning evidence had been collected under DPDP without verifiable guardian consent.

**Countermeasure:** §41. Written not copied; quotes confined to provenance and never served; per-source licence recording; and both this and the DPDP question treated as **launch gates** with named legal review.

## 5.7 Cause 7 — It was never proven to help

**Probability: moderate. Consequence: strategic drift.**

Grounded teaching shipped. Nobody measured it. Whether lessons improved was a matter of opinion, so resource allocation became a matter of opinion, and the graph competed for attention against features with visible metrics — and lost.

**Countermeasure:** §46 and the evidence spine. Grounded versus ungrounded is a recorded property of every lesson. Quality outcome is already captured. The comparison is a query, not a study.

---

# 6. System Goals

Numbered for reference. Each is testable; §44 gives the test.

| # | Goal | Verification |
|---|---|---|
| **G1** | Knowledge is independent of any curriculum. | Delete every curriculum row; the graph is unchanged and still teachable. |
| **G2** | Truth may be contextual without duplicating identity. | Two contradictory statements coexist on one concept, scoped differently, both VERIFIED. |
| **G3** | Nothing enters the graph without human verification. | No path from extraction to `VERIFIED` without a `ReviewEvent` with a human actor. |
| **G4** | Every statement traces to a source location. | Every VERIFIED statement has provenance whose quote is literally present in its source. |
| **G5** | Nothing is destroyed. | No `DELETE` in any knowledge write path except `purgeUser` on learner data. |
| **G6** | Any past lesson is reconstructable. | Given a lesson id, recover exact concept versions and graph release. |
| **G7** | New knowledge types require no schema change. | Add a type via registry entry; zero migrations, zero changes to base tables. |
| **G8** | New curricula require no new concepts. | Add a second board that maps entirely onto existing concepts. |
| **G9** | Storage is replaceable. | All access through `KnowledgeStore`; a second implementation passes the same conformance suite. |
| **G10** | The platform works empty. | Full test suite passes against a zero-row graph; teaching falls back cleanly. |
| **G11** | Identity is permanent and meaningless. | No FK references `slug`; a test fails if `Concept.id` is ever updated. |
| **G12** | Prerequisites are acyclic. | Whole-graph DAG check as a standing test. |
| **G13** | Determinism. | Same source bytes produce byte-identical chunk IDs across runs. |
| **G14** | Review throughput is a measured metric. | Concepts verified per hour is reported operationally. |
| **G15** | Grounding is measurable. | Grounded and ungrounded lessons are distinguishable in evidence and comparable on quality. |

## 6.1 Explicit quality attributes

**Correctness before availability.** A wrong statement is worse than a missing one. When in doubt, the platform declines to answer and the Teaching Engine falls back.

**Determinism before cleverness.** Every stage before extraction is pure. Extraction is the only nondeterministic step, and it is quarantined behind `Advice<T>`.

**Auditability before performance.** Every knowledge mutation is an append-only event with an actor. If a performance optimisation would erase an audit trail, it is rejected.

**Extensibility before completeness.** Ship three knowledge types with a registry that accepts thirty, rather than thirty types designed against no source material.

---

# 7. Non-Goals

Stating what Phase 2 deliberately does **not** do is as important as stating what it does. Each non-goal is a decision, with a reason.

| Non-goal | Why not now | When |
|---|---|---|
| **Mastery estimation** | Requires learner response data that does not exist. Designing a mastery model against zero observations produces a model calibrated to guesses. The `ConceptMastery` table exists as a shape only, with no score column (§2.4). | Phase 3 |
| **Digital Twin / learner model** | Same reason. The Learning layer is specified as a boundary, not implemented. | Phase 3 |
| **Recommendation** | Depends on mastery. | Phase 3+ |
| **Semantic / vector search** | Rungs 1–3 of search (exact, alias, trigram) are deterministic, need no new dependency, and are sufficient at the data volumes of the first two years. Vector search is designed for behind the same interface (§25) and switched on when lexical resolution demonstrably fails. | 2D+ |
| **A public HTTP knowledge API** | An API with no external consumer cannot be designed correctly. The review UI is the first consumer and will drive the route design. Internal TypeScript modules until then (§32). | When an external consumer exists |
| **Multi-language content** | The `language` context dimension ships in v1 and is populated with `en`. Translation workflow, RTL, and script-specific normalisation are not built. Critically, the *columns* exist so that translations are statements rather than duplicate concepts. | Post-CBSE |
| **Real-time collaborative editing of the graph** | Thousands of contributors is a stated future requirement, but concurrent editing needs conflict resolution that append-only versioning largely obviates. Deferred until contributor count exceeds one. | When contributors > ~5 |
| **Automated curriculum alignment** | Mapping a concept to a syllabus position is currently a human judgment. Automating it before observing many manual mappings would encode a guess. | Post 2D |
| **Ingesting non-text sources** (video, audio, images) | The connector interface accepts them (§37); no parser is built. Music and medical imaging will force this. | When a domain requires it |
| **Graph database deployment** | Interface designed for it; implementation not built. Postgres is chosen for real data volumes (§30). | When measurements demand it |
| **Tenant isolation for corporate knowledge** | The `scope` field ships and defaults to `PUBLIC`. Tenant-aware queries, tenant admin, and tenant billing are not built. | When a corporate customer exists |

## 7.1 Anti-goals — things that must never be built

These are not deferred; they are forbidden, because building them would violate the philosophy.

- **Auto-approval of extracted knowledge.** Under any backlog pressure, for any confidence threshold. §5.4 is the reason.
- **Deletion of knowledge rows** in normal operation. Deprecate, supersede, tombstone — never delete.
- **A `difficulty` column on `Concept`.** Difficulty is a relation between content and learner, computed by the Mastery Engine from intrinsic properties (§14.4). Storing it as content data is storing a conclusion.
- **Curriculum as a parent of knowledge.** A foreign key from `Concept` to any curriculum entity is prohibited and enforced by test (G1).
- **Meaning inside identifiers.** §29.
- **Serving verbatim source text to learners.** §41.

---

*End of Part I. Part II — Architecture (§8–11) follows in `02-architecture.md`.*
