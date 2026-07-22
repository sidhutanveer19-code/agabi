# AGABI Backend Phase 2 — Final Architecture Baseline

**Status:** FROZEN on approval. Supersedes RFC-1 and RFC-2 in full.
**Scope:** the permanent knowledge foundation. Every future backend engine builds on this and does not renegotiate it.

---

# 0. Architecture Audit

*RFC-1 and RFC-2 are inputs, not scripture. Seven contradictions were found between them. Two would have blocked implementation. All are resolved below and the resolution is binding.*

## 0.1 Contradictions found and resolved

| # | Contradiction | RFC-1 | RFC-2 | **Resolution** |
|---|---|---|---|---|
| **C1** | Entity naming | `Statement` | `Proposition` in schema, `Statement` in prose | **`Statement` everywhere.** RFC-2 shipped a schema and a narrative using different names for the same table — an implementer would have created both. Binding: the table is `Statement`; the word "proposition" is never used. |
| **C2** | `PART_OF` relationship | acyclic edge type alongside `REQUIRES` | **dropped entirely** | **Restored as a third graph.** Compositional containment (light reaction PART_OF photosynthesis) is neither a prerequisite nor a reinforcement. It is structural, acyclic, and needed for aggregation and topic rollup. RFC-2 lost it in the split. See §11.3. |
| **C3** | Assessment scheduling | built in Phase 2 (§19), per explicit decision | schema present, **absent from the roadmap** | **Restored to the roadmap** at 2E. The decision to author assessment alongside knowledge review stands — the reviewer already has the source open, which roughly halves the cost. |
| **C4** | Contradiction detection | defined only for SPO (`same subject, same predicate, overlapping context, different object`) | statements have seven `form`s | **Per-form detection.** SPO detection is one of seven rules. Non-SPO forms (conditional, quantified, causal, comparative, probabilistic, definitional) each need their own conflict rule or are explicitly marked undetectable. §14.4. |
| **C5** | Context identity | seven columns + unique constraint | `dimensions Json`, id = hash | **Canonical hashing specified.** A JSON column loses the uniqueness guarantee unless hashing is deterministic. Binding: keys sorted lexicographically, values normalised per dimension type, `id = sha256(canonicalJSON)`. Without this, two identical contexts get two rows and matching silently fragments. §13.2. |
| **C6** | Research connectors | fully specified (§37) | **dropped** | **Restored.** §24. |
| **C7** | Observability integration | health providers, metrics, scheduled jobs (§45) | **dropped** | **Restored.** §28. |

## 0.2 Weaknesses found in both, fixed here

| Weakness | Fix |
|---|---|
| Multi-tenancy asserted via a `scope` column; never specified | §23 — full isolation model, enforced in the store, conformance-tested |
| Deferred decisions scattered as 🔬 markers | §34 — one enumerated register with owners and triggers |
| No stated architectural review criteria | §35 — the review this document must pass to be frozen |
| Trust ladder promotion rules described in prose | §26 — promotion and demotion as a deterministic state function |
| No specified behaviour when the two graphs disagree | §11.5 — a concept cannot be both `REQUIRES` and `REINFORCES` in the same direction; the DAG wins and the reinforcement edge is rejected |

## 0.3 What carries forward unchanged

Curriculum as a mapping layer · opaque immutable identity with mutable slugs · append-only versioning · mandatory provenance with machine-checked grounding · knowledge types as a registry · no difficulty column · Postgres behind `KnowledgeStore` · the Phase-1 advisor walls.

---

# 1. Vision

**Agabi should know things, and teaching should be the act of selecting what it knows for a particular learner — not the act of asking a language model to invent a curriculum.**

Today it knows nothing. `defaultOutline(topic)` is string templating; its entire knowledge of photosynthesis is the word "photosynthesis". Everything a student learns comes from the weights of a free-tier model selected at request time — unversioned, unattributed, unverifiable.

Phase 1 secured the machinery and left the cargo unguarded. A model cannot advance a cursor. It can teach a fifteen-year-old that respiration reverses photosynthesis, and the architecture will faithfully deliver it.

Phase 2 closes that with the same invariant, extended one layer down.

## 1.1 The perfect outcome

Twenty years from now a maintainer can:

- ask what Agabi knows about consideration in contract law and receive statements scoped by jurisdiction, each traced to an authority, each with a validity window and a trust level
- replay a lesson from 2026 exactly, including which statement versions and which graph release were in force
- add a new board by inserting mapping rows and creating zero concepts
- add a new knowledge type, asset type, or context dimension by adding a registry row and touching zero tables
- discover that a concept was two concepts all along, split it, and have every historical reference resolve honestly rather than wrongly
- swap the storage engine by changing one module

If any of those requires a migration, the corresponding section is wrong.

---

# 2. Philosophy

**P1 · Knowledge is not documents.** A book is one serialisation, optimised for linear reading, frozen at an edition. Books, syllabi, papers and websites are *sources*. None is the architecture. The curriculum hierarchy must never be a parent of knowledge.

**P2 · Truth is contextual.** *"A contract requires consideration"* is true in India, false in France. *"First-line treatment is X"* was true in 2018. *"F = ma"* is true Newtonian, false relativistic. *"The octave has twelve semitones"* is true in Western tuning, false in Hindustani classical. A concept is a stable identity; a statement is a contextual assertion. Truth is not globally unique, and pretending otherwise forces a rewrite.

**P3 · The model is an advisor.** Extended from Phase 1: no model may establish knowledge. It proposes; the platform decides; humans establish trust. Enforced by the type system and the import graph, not by convention.

**P4 · Evidence over conclusions.** Store what cannot be recomputed. Ratios, scores, difficulty, mastery and recommendations are derived at read time, so improving a model reinterprets history instead of invalidating it.

**P5 · Nothing is destroyed.** Corrections are versions. Retractions are marks. Merges leave tombstones. The single exception is erasure of personal data, which is why learner observations live in a separate store.

**P6 · Knowing is not teaching.** *Photosynthesis converts light to chemical energy* is in every textbook and every model. *A fifteen-year-old who just heard "plants make food from sunlight" will assume the plant eats the sunlight, and the equation must not land on top of that* is in neither. The second is the product.

**P7 · The platform works empty.** Every component has meaningful behaviour on zero rows. Search returns nothing; traversal returns nothing; teaching falls back and records a miss. Coverage is incremental by construction.

---

# 3. First Principles

## 3.1 What teaching irreducibly requires

| Q | Question | Implies |
|---|---|---|
| Q1 | What is being learned? | stable identity → **Concept** |
| Q2 | What is true of it? | assertion, separable from identity → **Statement** |
| Q3 | Under what conditions? | **Context** |
| Q4 | What must come first? | **Dependency graph**, acyclic |
| Q5 | How do we know? | **Provenance + trust** |
| Q6 | How is it best taught? | **Teaching asset** |
| Q7 | Did the learner get it? | **Observation** |

Absent from that list: subject, chapter, class, board, page, difficulty. Every one is organisational convenience, not a requirement of teaching.

## 3.2 Subject is not universal

Is *rate of change* Mathematics or Physics? Is *osmosis* Biology or Chemistry? Every answer is defensible, so the question is malformed. Subject is how an institution divides teaching labour; it varies by board, country and decade.

**Binding:** `subject` is a tag, many-valued and editable. It never appears in identity, including inside identifiers.

## 3.3 Chapters are pagination

NCERT renumbered chapters between editions. The knowledge did not change. **Binding:** no concept has a chapter. Curriculum is a mapping.

## 3.4 Textbooks are not authoritative about reality

NCERT is authoritative *for CBSE examinations* — a real and useful authority. It is not authoritative about physical reality. Curricular authority and epistemic authority usually agree; when they disagree both must be representable, and an exam-preparing student must get the curricular answer while the platform retains the knowledge that reality differs.

**Binding:** `authority` is a first-class field on a statement.

## 3.5 The smallest unit

Concepts are **entities**; statements are **assertions about them**. *Chlorophyll*, *Light energy* and *Photosynthesis* are concepts; *"chlorophyll absorbs light energy"* is a statement linking two of them.

The argument is decisive: **identity must be stable under changing belief.** Everything known about chlorophyll may be revised; chlorophyll remains the same referent. A model where a corrected fact creates a new entity accumulates orphans, not knowledge.

## 3.6 Which constraints are real

| Claim | Real? | Why |
|---|:-:|---|
| Knowledge dependency is directional and acyclic | **yes** | if a genuine cycle existed in dependency, no learner could ever begin, and the subject would be unlearnable |
| Learning is iterative and cyclic | **yes** | optimisation deepens functions; respiration illuminates photosynthesis |
| Truth can be context-dependent | **yes** | logical |
| Forgetting occurs | **yes** | physical |
| Verification capacity is finite | **yes** | **the binding constraint of this phase** |
| Subjects | no | convention |
| Chapters | no | pagination |
| Difficulty is a property of content | no | it is a relation between content and learner |
| A lesson covers one topic | no | inherited from books |

The first two are the reason there are two graphs, not one.

## 3.7 The bottleneck

Not review speed. **The ratio of human attention to justified knowledge.** Doubling review speed halves a number that remains 10,000 person-years.

Therefore the architecture attacks the denominator: deterministic validators, cross-source corroboration, contradiction detection against already-verified knowledge, and inference. The decisive property is that **contradiction detection makes human effort per statement fall as the graph grows** — the only mechanism that makes 100M concepts arithmetically conceivable.

---

# 4. Mental Models Applied

*Recorded as findings, not as method.*

**Inversion** produced §32's premortem, which produced the labelling invariant, the split operation, and the module-level import rule keeping the two graphs apart.

**Falsification** produced §35's review criteria and the prediction in the roadmap that grounding alone yields little and teaching assets yield much — stated in advance so it can be wrong.

**Red-teaming** killed four RFC-1 claims and, on a second pass, killed two of the kills. Both reinstatements were cases where the attack correctly found that something was wrong and incorrectly identified what.

**Bottleneck targeting** moved the design's centre of gravity from the schema to review throughput, and then from review throughput to the *ratio*, which is where it belongs.

**Reverse engineering** from "the world's best learning platform" produced §13 — because the thing that must be true underneath is that the platform knows *how to teach*, not merely what is true.

---

# 5. Success Conditions

| # | Condition | Verification |
|---|---|---|
| S1 | Knowledge is independent of curriculum | drop all program rows; graph unchanged and teachable |
| S2 | Contextual truth without duplicate identity | two contradictory statements, one concept, both trusted, different contexts |
| S3 | Trust is graded and never silent | nothing below the policy floor is returned unlabelled |
| S4 | Every trusted statement traces to a source | quote literally present in its chunk |
| S5 | Nothing is destroyed | no delete path outside learner erasure |
| S6 | Any lesson is reconstructable | statement versions + release + assets recovered by lesson id |
| S7 | New types need no migration | registry insert only |
| S8 | New curricula need no new concepts | second board maps entirely onto existing concepts |
| S9 | Storage is replaceable | second `KnowledgeStore` passes the same conformance suite |
| S10 | The platform works empty | full suite green on zero rows |
| S11 | Identity is permanent and meaningless | no FK targets `slug`; `Concept.id` never updated |
| S12 | Dependency is acyclic; reinforcement is not | both tested, and the reinforcement test asserts cycles **pass** |
| S13 | Determinism | identical bytes produce identical chunk ids |
| S14 | Grounding is measurable | grounded / asset-supported / ungrounded distinguishable per lesson |
| S15 | Tenancy is isolated | no query returns another tenant's knowledge |

---

# 6. Architecture Goals

Correctness before availability. Determinism before cleverness. Auditability before performance. Extensibility before completeness. **Every one of these is a tiebreak rule, applied when a decision is otherwise balanced.**

---

# 7. Non-Goals

| Not built | Why | When |
|---|---|---|
| Mastery estimation | needs response data that does not exist | Phase 3 |
| Digital twin, recommendation | depend on mastery | Phase 3+ |
| Teaching Engine | Phase 2 builds its substrate only | Phase 3 |
| Semantic/vector search | deterministic rungs suffice at current volumes; designed behind the same interface | when rung 3 measurably fails |
| Public HTTP knowledge API | no external consumer; the review UI drives route design | when one exists |
| Multi-language content | `language` dimension ships; translation workflow does not | post-CBSE |
| Automated curriculum alignment | would encode a guess before many manual mappings are observed | post-2F |
| Non-text source parsing | connector interface accepts them; no parser built | when a domain requires it |
| Graph database deployment | interface ready; implementation not needed | when measured |

## 7.1 Anti-goals — forbidden, not deferred

- **Auto-promotion above `AUTO_VALIDATED`.** Under any backlog pressure, at any confidence.
- **Deletion of knowledge** in normal operation.
- **A difficulty column** anywhere.
- **A `verified: boolean`.** Trust has levels.
- **A curriculum foreign key on knowledge.**
- **Meaning inside identifiers.**
- **Serving verbatim source text to learners.**
- **Joining the knowledge and observation stores.**
- **A single unified edge table.**

Each is enforced by a test named in §29. If a test is deleted, the principle has been abandoned regardless of what this document says.

---

*Part II — architecture and data model.*
