# RFC-2 · Part III — The Teaching Knowledge Layer

*The layer RFC-1 did not have. Designed in full; populated later. The Teaching Engine is not built in Phase 2 — its substrate is.*

---

# 20. Why this layer exists

## 20.1 The distinction, stated precisely

**Knowledge:** *Photosynthesis converts light energy into chemical energy.*
True. Verifiable. Sourced. In every textbook. **Every language model already knows it.**

**Teaching knowledge:** *A fifteen-year-old who has just learned that plants "make food from sunlight" will almost always assume the plant is eating the sunlight. Name that assumption before introducing the equation, or the equation lands on top of a wrong model and reinforces it.*

Not true or false. Not in any textbook. Not derivable from the first statement. **No model reliably knows it.**

The second is what makes teaching good. It is also, unlike the first, genuinely scarce — which is why it is where durable advantage lives.

## 20.2 The strategic argument

Grounding lessons in verified knowledge makes them **accurate**. Accuracy was never the differentiator, because accuracy is commodity — the frontier models are already accurate about Class 10 Biology.

What they are inconsistent at: choosing the analogy that fits *this* learner, anticipating the misconception *before* it forms, sequencing the reveal so understanding compounds, knowing which worked example exposes the common error.

RFC-1 would have grounded every lesson perfectly and measured no improvement, because it was fixing something that was not broken. **§4.7's "prove it helps" test would have failed, and the conclusion drawn would have been wrong** — not "grounding doesn't work" but "we grounded the wrong layer."

## 20.3 The rule 🔒

> **The Teaching Engine must never invent pedagogy from scratch.** It retrieves structured teaching knowledge from the platform and composes it. Where teaching knowledge is absent, it falls back to model-generated presentation — clearly marked as such, and the gap is recorded as demand.

Same shape as the knowledge invariant. The model presents; the platform decides what to present.

---

# 21. The teaching asset model

## 21.1 One base, many kinds — the registry pattern again

```prisma
model TeachingAsset {
  id          String   @id
  kind        String              // registry — see 21.2
  conceptId   String              // what it teaches
  statementId String?             // optional: the specific assertion it conveys
  payload     Json                // kind-specific, validated by registry
  contextId   String              // audience, language, level, prior knowledge
  trustLevel  String              // SAME LADDER as knowledge (§19)
  efficacy    Json?               // OBSERVED outcomes — never authored
  version     Int      @default(1)
  supersedes  String?
  scope       String   @default("PUBLIC")
  @@index([conceptId, kind, trustLevel])
  @@index([statementId])
}
```

Three properties carried deliberately from the knowledge layer:

**Context-scoped.** The right analogy for a fifteen-year-old in Delhi differs from the right analogy for a medical student. Same concept, different asset. The same open dimension registry (§18) applies — `audience`, `priorKnowledge`, `language`, and any dimension a future domain registers.

**Trust-rated.** A teaching asset can be bad. An analogy can mislead; a worked example can contain an error; a mnemonic can encode a misconception. The same ladder applies, with the same admission policy.

**Efficacy is observed, never authored.** No `quality: 4` column. Efficacy accumulates from L6 observations — did learners who received this asset perform better afterwards? An authored quality rating is an opinion; a measured one is evidence.

## 21.2 Asset kinds

Registry entries, not schema. Adding one is an insert.

### Explanation and intuition

| Kind | Payload core | Notes |
|---|---|---|
| `INTUITIVE_EXPLANATION` | text, entryPoint, assumedKnowledge[] | the plain-language version that comes *before* rigour |
| `FORMAL_EXPLANATION` | text, rigourLevel | the precise version |
| `ANALOGY` | source domain, target mapping[], **breakdownPoint** | see §21.3 |
| `MENTAL_MODEL` | model, whenItApplies, whenItFails | the durable structure a learner keeps |
| `STORY` | narrative, hook, payoff | narrative memory is stronger than propositional memory |
| `MEMORY_ANCHOR` | device, whatItEncodes, risks | mnemonics, with their failure modes recorded |

### Demonstration

| Kind | Payload core |
|---|---|
| `WORKED_EXAMPLE` | problem, steps[{action, reasoning, commonErrorHere}], answer |
| `COUNTEREXAMPLE` | case, whyItBreaks, whatItTeaches |
| `EXPERIMENT` | setup, procedure, expectedObservation, whatItDemonstrates |
| `SIMULATION` | parameters, invariants, explorationPrompts |
| `REAL_WORLD_APPLICATION` | context, howTheConceptAppears, whyItMatters |

### Visual

| Kind | Payload core |
|---|---|
| `DIAGRAM_SPEC` | blockType (existing catalogue), data, whatItShows |
| `WHITEBOARD_FLOW` | ordered reveal steps, what appears when, narration |
| `ANIMATION_SPEC` | timeline, what changes, what stays fixed |

`DIAGRAM_SPEC` binds directly to Agabi's existing 40+ block catalogue. A teaching asset can specify *"this concept is best shown as a `flow` with these five nodes"* — turning `pickVisualFor`'s regex heuristic into retrieved, verified, efficacy-measured knowledge.

### Misconception

| Kind | Payload core | Notes |
|---|---|---|
| `MISCONCEPTION` | wrongModel, whyItIsAppealing, whatItPredictsWrongly | **the highest-value kind** |
| `MISCONCEPTION_CORRECTION` | targets misconception, confrontation strategy, resolution | |
| `DISCRIMINATION` | conceptA, conceptB, theDistinction, diagnosticQuestion | pairs with `COMMON_CONFUSION` (§16.4) |

### Interaction

| Kind | Payload core |
|---|---|
| `SOCRATIC_SEQUENCE` | ordered questions, expected answers, branch on each |
| `RETRIEVAL_PROMPT` | cue, targetRecall, spacingInterval |
| `EXERCISE` | task, difficulty band, targets concept + Bloom level |
| `PROJECT` | brief, deliverable, rubric, concepts exercised |

### Strategy

| Kind | Payload core |
|---|---|
| `TEACHING_STRATEGY` | approach, whenToUse, prerequisites, evidence |
| `TEACHING_ORDER` | ordered concepts, rationale, alternatives |
| `AGE_ADAPTATION` | ageBand, whatChanges, whatMustNotBeSimplifiedAway |
| `DIFFICULTY_ADAPTATION` | band, scaffolding added, what is removed |
| `REVISION_STRATEGY` | schedule, cue type, interleaving policy |

## 21.3 `ANALOGY.breakdownPoint` is mandatory 🔒

Every analogy is wrong somewhere. An analogy taught without its limit **installs a misconception** — the learner extends the mapping past where it holds and is confidently wrong in a way that is hard to detect and harder to unlearn.

*"Electric current is like water in a pipe"* is excellent for resistance and flow, and it breaks at capacitance, at the fact that charge is not consumed, and at the speed of signal propagation. A learner who was not told will carry all three errors forward.

The field is **required by schema**, not by convention. An analogy without a stated breakdown point fails validation and cannot be stored.

This is the kind of thing that is obvious once written down, invisible while writing prose, and impossible to retrofit across thousands of assets.

## 21.4 `MISCONCEPTION` is the most valuable asset kind

It is:

- **Not in textbooks.** Textbooks state what is true; they rarely catalogue what learners wrongly believe.
- **Not reliably known by models.** They can generate plausible misconceptions; they cannot tell you which ones *actually occur* at what frequency in which population.
- **Empirically discoverable.** L6 observations reveal it: wrong answers cluster, and clusters are misconceptions with evidence attached.
- **Directly actionable.** Knowing the misconception lets teaching pre-empt rather than correct.

Misconceptions are also `MISCONCEPTION_OF` edges in L2's reinforcement graph, so the Mastery Engine can eventually track *which wrong model a learner holds* rather than *which questions they failed*. That is diagnosis instead of scoring, and it is the difference between a tutor and a quiz.

---

# 22. How the Teaching Engine will consume this

*Specified so the substrate is right. Not built in Phase 2.*

```
learner + topic + objective
        │
        ▼
  L2  resolve → dependency closure (DAG) → readiness → concept path
        │
        ▼
  L3  statementsFor(concepts, context, trustPolicy)      WHAT is true
        │
        ▼
  L4  assetsFor(concepts, statements, learnerContext)    HOW to teach it
        │        ranked by efficacy, filtered by trust and context
        ▼
      compose lesson plan
        │  ordered assets · diagram specs · misconceptions to pre-empt
        │  Socratic branches · retrieval prompts
        ▼
      MODEL RENDERS the plan  ← its only remaining freedom is wording
        │
        ▼
      EXISTING PIPELINE: repairOutline → buildSkeleton → fillChunk → stream
        │
        ▼
  L6  observations recorded → efficacy updated → reinforcement edges earned
```

The loop closes at L6. Teaching produces observations; observations improve efficacy ratings and earn reinforcement edges; better assets get selected next time. **The platform learns how to teach**, which is the property that compounds and which no amount of model improvement supplies.

## 22.1 Degradation is designed, not accidental

| Available | Behaviour |
|---|---|
| L2 + L3 + L4 | fully composed lesson, every element retrieved and traceable |
| L2 + L3 only | grounded but generically presented; `teaching.miss` recorded |
| L2 only | correct sequencing, model-generated content; `knowledge.miss` recorded |
| nothing | today's `defaultOutline`; `knowledge.miss` recorded |

Each miss names exactly what was absent. **The miss log is the content backlog**, ordered by real demand rather than by curriculum order — and it distinguishes "we don't know this" from "we don't know how to teach this", which are different work items with different people doing them.

---

# 23. Where teaching knowledge comes from 🔬

Harder to source than knowledge. Textbooks contain knowledge; pedagogy lives in teachers, in education research, and in observed learner behaviour.

| Source | Yields | Trust ceiling |
|---|---|---|
| Education research literature | misconceptions, strategies, sequencing | `EXPERT_REVIEWED` |
| Teacher-authored material | analogies, worked examples, anchors | `COMMUNITY_REVIEWED` |
| Existing worked solutions | `WORKED_EXAMPLE` | `AUTO_VALIDATED` |
| **Observed learner errors (L6)** | **misconceptions, with frequency** | `AUTO_VALIDATED`, promotable |
| Model proposal | drafts of any kind | `MACHINE_PROPOSED` |
| Agabi's own efficacy data | strategy selection, adaptations | earned |

The fourth row is the one that compounds. Every wrong answer is a signal about how learners actually fail. A platform with observations discovers misconceptions that no textbook lists — and that knowledge is not available to anyone who has not been teaching at scale.

**This is the asset that cannot be copied**, and it is the reason L6 is a first-class store rather than analytics exhaust.

---

# 24. Phase 2 scope for L4 — deliberately narrow ⚖️

Build: the schema, the kind registry, the trust integration, the context integration, `assetsFor()` retrieval, and the efficacy structure.

Populate: **`MISCONCEPTION`, `ANALOGY`, and `WORKED_EXAMPLE` only**, and only for the chapters already knowledge-verified.

Do not build: the Teaching Engine, efficacy computation, asset generation pipelines, or the remaining twenty-odd kinds.

**Why these three.** Misconceptions are the highest value and the least available elsewhere. Analogies are what learners actually remember. Worked examples are cheap to source — every textbook is full of them — which makes them a good test of whether the layer works at all before expensive content is committed to it.

Twenty-plus kinds designed with no source material would be twenty-plus guesses. Three kinds, populated and measured, tell you whether the shape is right before the cost is sunk.

---

*Part IV covers observation, storage, migration, testing and the roadmap.*
