# RFC-2 · Part IV — Observation, Physical Design, and Build

---

# 25. The Observation Layer 🔒

## 25.1 What is stored

> **A performance observation:** this learner, on this task, in this context, at this moment, produced this outcome.

```prisma
model Observation {
  id          String   @id
  learnerId   String
  taskId      String?              // assessment item, exercise, or lesson interaction
  conceptIds  String[]             // what this exercised
  contextId   String               // ← REQUIRED. see §17.2 — makes future splits resolvable
  outcome     Json                 // response, correctness, partial credit, latency
  bloomLevel  String?              // recall ≠ application, even of the same concept
  assetIds    String[]             // which teaching assets preceded this → efficacy
  occurredAt  DateTime
  @@index([learnerId, occurredAt])
  @@index([conceptIds])
}
```

**No mastery column. No score. No confidence estimate.** Every one of those is a conclusion, and conclusions are computed on read.

## 25.2 Mastery is a query 🔒

```ts
mastery(learnerId, conceptId, atBloom?, asOf?) → MasteryEstimate
```

Computed from observations by whatever model is current. When the model improves — from a naive percentage to Bayesian knowledge tracing to something better — **it reinterprets all history**. Under RFC-1's `ConceptMastery` row, improving the model would have invalidated every stored value with no way to recompute.

This also makes representable what RFC-1 could not: mastery at recall but not application (same concept, different Bloom level), decay over time, transfer to unfamiliar contexts, misconception-specific failure, and confidence versus accuracy.

## 25.3 Separate store 🔒

Observations are high-volume, privacy-regulated, erasable, and learner-owned. Knowledge is low-volume, public, permanent, and impersonal.

They share **nothing but concept ids**. Separate databases, separate backups, separate retention policies, separate access control.

A DPDP erasure request deletes a learner's observations and cannot touch the knowledge graph. Under a shared schema, erasure and knowledge integrity are coupled — and the coupling only reveals itself during an incident.

## 25.4 The compounding loop

```
observations → misconceptions discovered (frequency, population)
            → reinforcement edges earned (transfer measured, not guessed)
            → asset efficacy measured (which analogy actually works)
            → difficulty derived (per learner, per context)
            → better teaching → better observations
```

None of it is authored. All of it is earned. **This loop is the only genuinely defensible asset in the architecture** — a competitor can copy the schema, license the same textbooks, and use the same models. They cannot copy what Agabi has observed about how learners fail.

---

# 26. Physical design

## 26.1 Three stores

| Store | Holds | Properties |
|---|---|---|
| **Knowledge** (Postgres) | L1–L5: sources, concepts, both graphs, statements, teaching assets, programs | append-only · versioned · public · permanent · low write volume |
| **Observation** (Postgres, separate instance) | L6 | append-only · high volume · private · erasable · partitioned by time |
| **Derived** (caches and indexes) | closures, search, efficacy rollups, mastery snapshots | **rebuildable · never authoritative · losing it is a rebuild** |

## 26.2 Why Postgres, correctly argued

RFC-1 justified it by traversal depth. The real justification is stronger:

1. **Atomic multi-row writes with auditable history are non-negotiable.** A review decision commits statements, edges, assets and review events together or not at all. Without transactions a partial failure is silent graph corruption with no consistent state to compare against.
2. **The workload is majority-relational.** Context ranking, trust filtering, text matching, and analytics are relational. Genuine graph traversal is bounded (`REQUIRES` closure is single-digit depth) and cacheable.
3. It is already deployed. Zero new infrastructure for a product with no users.
4. `KnowledgeStore` makes the decision reversible at the cost of one file.

**Falsifier:** if `REQUIRES`-closure p95 exceeds 50 ms *with* the closure cache in place, introduce a traversal engine as a derived store behind the same interface. Not before.

## 26.3 Scale

| Concepts | Statements | Assets | Observations | Architecture |
|---|---|---|---|---|
| 10² | 10³ | 10² | 10³ | single instance |
| 10⁴ | 10⁵ | 10⁴ | 10⁶ | + closure cache |
| 10⁶ | 10⁷ | 10⁶ | 10⁹ | + read replica, search index, observation partitioning |
| 10⁸ | 10⁹ | 10⁸ | 10¹² | + partitioning, + traversal engine if measured |

Observations dominate by three orders of magnitude, which is exactly why they are a separate store with independent partitioning and retention.

Nothing in the logical model changes at any step. Every change is additive and operational.

---

# 27. Testing — invariants over data, not units of code

| Test | Asserts |
|---|---|
| `dependency-dag` | `REQUIRES` is acyclic across the whole graph |
| `reinforcement-cycles-ok` | cycles in the reinforcement graph do **not** fail — the DAG check must not overreach |
| `grounding` | every statement above `AUTO_VALIDATED` has a quote literally present in its source |
| `provenance` | every statement above `MACHINE_PROPOSED` has provenance |
| `trust-monotonic` | no promotion above `AUTO_VALIDATED` without a `ReviewEvent` with a human actor |
| `trust-demotion` | a raised contradiction demotes within one job cycle |
| `no-silent-uncertainty` | nothing below the policy's `labelBelow` is ever returned unlabelled |
| `analogy-breakdown` | every `ANALOGY` has a non-empty `breakdownPoint` |
| `split-resolvable` | every concept reference records its usage context |
| `identity` | no FK targets `slug`; `Concept.id` is never updated |
| `no-delete` | no destructive operation in any knowledge path |
| `store-separation` | no query joins knowledge and observation stores |
| `curriculum-independence` | dropping all programs leaves the graph teachable |
| `empty-platform` | full suite passes on zero rows; teaching falls back cleanly |
| `context-registry` | adding a dimension requires no migration |
| `conformance` | any `KnowledgeStore` implementation passes the same suite |

`trust-monotonic`, `no-silent-uncertainty` and `analogy-breakdown` are the three that encode RFC-2's distinctive commitments. If any is deleted, the corresponding principle has been abandoned regardless of what the prose says.

---

# 28. Roadmap

Each phase compiles, passes tests, and requires no rewrite of its predecessor.

**2A · Spine.** Both graphs (DAG + reinforcement), concepts with split support, propositions, context registry, trust ladder with deterministic validators, provenance, review with `ReviewEvent`. `KnowledgeStore` + conformance suite. Ingest **one chapter**. Golden set authored alongside.
✅ *A student sees a grounded lesson; every block traces to a concept; the DAG check passes; a deliberate cycle in `REINFORCES` does not fail the build.*

**2B · Bridge.** `selectPath` over the DAG, `outlineFrom`, the one call site in `manager.ts`, trust policy per use, grounded prompt, `knowledge.miss`, evidence stamping.
✅ *Grounded and ungrounded lessons are indistinguishable in shape, distinguishable in evidence.*

**2C · Trust at scale.** Cross-source corroboration, contradiction detection against verified knowledge, inference with derivation records, promotion and demotion jobs, review UI with batch context, reputation capture.
✅ *A statement reaches `AUTO_VALIDATED` with zero human involvement, and a contradiction demotes it automatically.*

**2D · Teaching layer.** `TeachingAsset`, registry, `assetsFor()`, efficacy structure. Populate `MISCONCEPTION`, `ANALOGY`, `WORKED_EXAMPLE` for verified chapters.
✅ *A lesson pre-empts a misconception before the learner forms it — the first thing no model does reliably.*

**2E · Observation.** Separate store, `Observation`, mastery-as-query, efficacy computation, earned reinforcement edges.
✅ *A `REINFORCES` edge exists that nobody authored, derived from measured transfer.*

**2F · Breadth and time.** Remaining subjects (Maths exercises `PROCEDURE`, English exercises `SKILL`), program layer for CBSE Class 10, version chains, releases, point-in-time replay, split executed for real at least once.
✅ *A lesson from three months ago replays with the exact text the learner saw.*

**Sequencing:** 2A blocked on the evidence-spine reconstruction proof. 2D may start once 2A produces verified chapters. 2E requires 2D.

## 28.1 The decision point after 2B

2B produces the first evidence on the question the whole phase rests on: **does grounding improve lessons?**

RFC-1 would have answered *no* and drawn the wrong conclusion. RFC-2 predicts: grounding alone produces a **small** improvement in accuracy and **no** improvement in perceived quality; the large gain arrives with 2D, when misconceptions and analogies enter.

That prediction is falsifiable, and it should be tested before the expensive content work in 2F. If 2D also shows nothing, the thesis is wrong and the plan must change.

---

# 29. Decision record index

| ADR | Decision | Confidence |
|---|---|---|
| R2-1 | Two graphs: acyclic `REQUIRES`, cyclic reinforcement | 🔒 |
| R2-2 | Trust ladder of six levels; consumer declares the floor | 🔒 |
| R2-3 | Never present uncertain knowledge unlabelled | 🔒 |
| R2-4 | Context is an open typed dimension registry | 🔒 |
| R2-5 | Reference identity permanent; referent revisable; split first-class | 🔒 |
| R2-6 | Every concept reference records its usage context | 🔒 |
| R2-7 | Teaching Knowledge Layer as a peer of the assertion layer | 🔒 |
| R2-8 | `ANALOGY.breakdownPoint` mandatory | 🔒 |
| R2-9 | Observations stored; mastery computed on read | 🔒 |
| R2-10 | Knowledge and observation in separate stores | 🔒 |
| R2-11 | Postgres canonical; derived stores on measurement | ⚖️ |
| R2-12 | Curriculum is a mapping layer (carried from RFC-1) | 🔒 |
| R2-13 | Knowledge and asset types are registries | 🔒 |
| R2-14 | No difficulty column anywhere | 🔒 |
| R2-15 | L4 ships three asset kinds, not twenty-eight | ⚖️ |

## 29.1 What cannot be reversed

1. Reference identity and split resolvability (R2-5, R2-6)
2. Append-only versioning
3. Mandatory provenance
4. Open context dimensions (R2-4)
5. Concept / assertion / teaching-asset separation (R2-7)
6. Store separation (R2-10)

Everything else is rebuildable.

## 29.2 What is still a guess

| Guess | Measured by |
|---|---|
| Three asset kinds are the right starting three | 2D |
| Corroboration thresholds for auto-promotion | 2C |
| That teaching assets, not grounding, drive quality | 2B vs 2D |
| Review throughput | 2A |
| Single-pass extraction adequacy | 2A |

All five resolve within the roadmap. None is marked load-bearing, which is the correction to RFC-1's most dangerous property: **four of its six fatal errors were marked as permanent certainties.**

---

# 30. What changed from RFC-1, in one table

| | RFC-1 | RFC-2 |
|---|---|---|
| Centre | knowledge graph | knowledge + **teaching** + observation, three peers |
| Prerequisites | one DAG for everything | **two graphs** — acyclic `REQUIRES`, cyclic reinforcement |
| Trust | binary, human-only | **six-level ladder**, consumer-declared floor, automatic demotion |
| Context | 7 fixed columns | **open typed registry** |
| Identity | referent assumed stable | reference stable, **split first-class** |
| Mastery | `(userId, conceptId)` row | **observations stored, mastery queried** |
| Assertions | SPO required | SPO is an **index**; propositions are typed |
| Pedagogy | **absent** | **L4, fully specified** |
| Stores | one schema | **knowledge and observation separated** |
| Bottleneck | review speed | **the ratio** — validators, corroboration, contradiction, inference |
| Curriculum | mapping layer | unchanged — the one claim that survived intact |

---

*End of RFC-2.*
