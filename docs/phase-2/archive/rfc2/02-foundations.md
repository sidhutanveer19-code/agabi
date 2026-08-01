# RFC-2 · Part II — Foundations

---

# 13. The irreducibles

After the destruction, six things remain that cannot be reduced further. Everything in RFC-2 is derived from these and nothing else. Any structure not traceable to one of them is convenience and must justify itself separately.

| # | Irreducible | Why it cannot be reduced | Consequence |
|---|---|---|---|
| **I1** | Some knowledge genuinely requires other knowledge first | A property of minds, not curricula. You cannot understand a derivative without a function. | Knowledge Dependency Graph, acyclic (§15) |
| **I2** | Understanding deepens by return, not by single pass | Observed universally. Optimisation deepens functions; respiration illuminates photosynthesis. | Learning Reinforcement Graph, cyclic (§16) |
| **I3** | Truth holds under conditions | `F = ma` is true Newtonian, false relativistic. Consideration is required in India, not France. | Open context dimensions (§18) |
| **I4** | Belief must be revisable without losing identity | Chlorophyll survives every revision of what we know about it. | Reference stability + versioning (§17) |
| **I5** | Justification has degrees | "Three independent sources agree" and "a model said so" are different epistemic states. | Trust ladder (§19) |
| **I6** | Knowing a thing is true is not knowing how to teach it | The best analogy for a fifteen-year-old is not a fact about the world. | Teaching Knowledge Layer (Part III) |

**I6 is the one RFC-1 missed entirely**, and it is the one closest to the product. Agabi's advantage was never going to be knowing that photosynthesis produces glucose — every model knows that. It is knowing *how to make a fifteen-year-old understand it*.

---

# 14. The architecture in one diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│  L6  OBSERVATION        performance observations · append-only        │
│                         SEPARATE STORE — privacy-regulated, erasable  │
│                         Mastery is a QUERY over this, never a column  │
├───────────────────────────────────────────────────────────────────────┤
│  L5  PROGRAM            Learning Programs → mappings onto L2          │
│                         CBSE · MBBS · ABRSM · AWS · JEE               │
│                         Delete all of L5 → L1-L4 unharmed             │
├───────────────────────────────────────────────────────────────────────┤
│  L4  TEACHING           how to teach it  ◄── THE MISSING LAYER        │
│                         explanations · analogies · worked examples    │
│                         misconceptions · Socratic prompts · anchors   │
│                         audience-scoped, trust-rated, versioned       │
├───────────────────────────────────────────────────────────────────────┤
│  L3  ASSERTION          what is true, under which conditions          │
│                         propositions · context · trust · provenance   │
├───────────────────────────────────────────────────────────────────────┤
│  L2  ENTITY             what exists                                   │
│                         concepts · DEPENDENCY graph (DAG)             │
│                                  · REINFORCEMENT graph (cyclic)       │
├───────────────────────────────────────────────────────────────────────┤
│  L1  SOURCE             where it came from                            │
│                         documents · provenance · licence · checksum   │
└───────────────────────────────────────────────────────────────────────┘

   References point DOWNWARD only. L2 references nothing above it.
   L4 and L3 are PEERS — neither derives from the other.
```

**Two changes from RFC-1 that matter most:**

**L4 is new.** RFC-1 had five layers and no home for pedagogy. A lesson built purely from L3 is accurate and possibly dull. A lesson built from L3 + L4 is accurate *and* teaches. The second is the product.

**L6 is a separate store, not a separate table.** Learner observations are high-volume, privacy-regulated and erasable. Knowledge is low-volume, public and permanent. Coupling them means a DPDP erasure request becomes a knowledge-graph incident. They share nothing but concept ids.

---

# 15. The Knowledge Dependency Graph 🔒

## 15.1 Definition

> A directed **acyclic** graph over concepts. Exactly one edge type: `REQUIRES`. An edge `A REQUIRES B` asserts that understanding A is not possible without B.

## 15.2 Why acyclic, defended properly

RFC-1 asserted this. RFC-2 argues it, having first tried to destroy it.

The test that settles it: **can a competent teacher construct an entry point?** If a genuine cycle existed in *knowledge dependency*, no learner could ever begin — there would be no accessible starting concept, and the subject would be unlearnable. Since every subject is learnable by someone who started from nothing, knowledge dependency must have an acyclic core.

The apparent counterexamples all dissolve on inspection:

| Apparent cycle | Resolution |
|---|---|
| limits ⇄ derivatives | `limits REQUIRES` nothing of derivatives. `derivatives REQUIRES limits`. The reverse arrow is `REINFORCES` — L2's other graph. |
| vocabulary ⇄ reading | `reading REQUIRES` a *minimal* vocabulary — a different, smaller concept than the mature vocabulary reading later builds. The cycle is an artefact of naming two things the same. |
| force ⇄ mass | Both `REQUIRE` a prior operational concept (push, resistance to change). `F = ma` relates them; it does not make either prerequisite to the other. |
| grammar ⇄ writing | `REINFORCES`, both directions. Neither is required first — children write before they know grammar. |

Every one is a **reinforcement relationship misfiled as a prerequisite**. The DAG constraint is what forces that distinction to be made explicitly, which is precisely its value: it makes vague pedagogical intuition into a checkable claim.

## 15.3 Enforcement

Unchanged from RFC-1 §20.2 and correct there: rejected on write with the cycle path displayed, whole-graph DFS in CI, scheduled operational check. A cycle in `REQUIRES` is a data error, and it now has an unambiguous remedy — the offending edge is a reinforcement edge and belongs in the other graph.

## 15.4 What this graph is used by

Path planning · prerequisite gating · curriculum sequencing · readiness checks · review prioritisation by leverage. All deterministic, all needing a stable sort.

---

# 16. The Learning Reinforcement Graph 🔒

## 16.1 Definition

> A directed graph over concepts. **Cycles are legal and expected.** Every relationship that is not a strict prerequisite lives here.

## 16.2 Edge types

| Type | Meaning | Cyclic | Consumer |
|---|---|:-:|---|
| `ENABLES` | makes another materially easier, without being required | often | sequencing hints |
| `REINFORCES` | learning this strengthens that | **yes** | spaced revision |
| `REVISITS` | returns to an earlier idea at greater depth | **yes** | spiral curricula |
| `TRANSFER_TO` | understanding here transfers there | **yes** | recommendation |
| `CO_OCCURS` | usually learned together | **yes** | grouping |
| `COMMON_CONFUSION` | learners routinely conflate these | **yes** | diagnosis, contrastive teaching |
| `ANALOGOUS_TO` | structurally similar, different domain | **yes** | analogy selection (L4) |
| `CONTRASTS` | usefully compared | **yes** | contrastive teaching |
| `SUCCEEDS` | historically replaced | no | history of ideas |

## 16.3 Worked cycles — all legal, all true

```
Functions ──REINFORCES──▶ Derivatives ──REINFORCES──▶ Optimisation
     ▲                                                      │
     └──────────────────REINFORCES──────────────────────────┘

Photosynthesis ⇄ Cellular respiration ⇄ Energy ⇄ Photosynthesis
Programming ⇄ Debugging
Grammar ⇄ Writing ⇄ Reading ⇄ Grammar
```

Meanwhile the dependency graph beneath them stays clean and sortable:

```
Function ──REQUIRES──▶ nothing
Limit    ──REQUIRES──▶ Function
Derivative ──REQUIRES──▶ Limit
Optimisation ──REQUIRES──▶ Derivative
```

Both are true simultaneously. RFC-1 could represent only the second; a relaxed single graph would have destroyed it. Two graphs represent both, and each stays correct on its own terms.

## 16.4 `COMMON_CONFUSION` is load-bearing for teaching

Learners conflate *weight* and *mass*, *velocity* and *acceleration*, *affect* and *effect*, *precision* and *accuracy*, *correlation* and *causation*.

This is not a fact about the world — no truth links weight and mass as "confusable". It is a fact about **minds**, and it is one of the most valuable things a teaching platform can hold: it tells the Teaching Engine what to disambiguate *before* the learner conflates it.

RFC-1 had no way to express it. It is an edge type here and a first-class input to L4.

## 16.5 Reinforcement edges should eventually be earned, not authored 🔬

Authored in v1. They should be **derived from observation**: if mastering X measurably improves later performance on Y, that is a `REINFORCES` edge with evidence behind it.

This is the single largest long-term advantage of separating L6 as a store: the reinforcement graph becomes empirical rather than intuitive, and Agabi ends up knowing things about how learning transfers that no textbook contains.

---

# 17. Identity, revised

## 17.1 Reference stability survives; referent stability does not

**Reference stability 🔒** — an issued id always resolves. Opaque, immutable, meaningless. RFC-1 §29 was right and its reasoning (reclassification, reorganisation, multilingual expansion) is carried forward unchanged.

**Referent stability ✂️** — the claim that a concept names a fixed thing in the world. False. Concept boundaries are drawn by people and are revisable.

## 17.2 Split is a first-class operation 🔒

RFC-1 supported merge and not split. Split is the harder direction and the one reality forces.

**The scenario:** eighteen months in, a reviewer realises `c_energy` has been used for *kinetic energy* in Physics contexts and *energy generally* in Biology contexts. Two ideas, one node, hundreds of statements, dozens of edges, and — once L6 exists — thousands of observations.

**The operation:**

```
split(sourceId, [targetA, targetB], plan) →
  1. create the new concepts
  2. RE-ATTRIBUTE each statement            (reviewer decides, per statement,
                                             or by context rule)
  3. RE-ATTRIBUTE each edge                  (both graphs)
  4. APPORTION observations                  (L6 — by the context of the
                                             observation, never guessed)
  5. tombstone the source with a SPLIT marker
     → resolution is now AMBIGUOUS, not automatic
  6. ReviewEvent records the complete plan
```

**Step 5 is the hard part and must be honest.** After a merge, the old id resolves to exactly one target. After a split, it resolves to *two*, and any historical reference that did not record enough context to disambiguate is genuinely ambiguous. The platform must say so rather than guess.

**Design consequence, and the reason this is in Part II rather than an appendix:** every reference to a concept — in a lesson record, an observation, a mapping — MUST also record the **context in which it was used**. Not for context matching, but so that a future split can be resolved rather than guessed. This costs one column now and is unrecoverable later.

RFC-1 could not have added this retroactively. That is what makes it load-bearing.

---

# 18. Context as an open registry 🔒

## 18.1 The correction

RFC-1 froze seven dimensions. RFC-2 makes dimensions **registry entries**, exactly as it makes knowledge types registry entries.

```ts
export interface ContextDimension {
  key: string;                    // "jurisdiction", "physicsRegime", "musicTradition"
  valueType: "enum" | "iso3166" | "iso639" | "range" | "date" | "string";
  values?: string[];
  specificity: number;            // ordering weight in the lattice
  appliesTo?: string[];           // optional: kinds this dimension is meaningful for
  since: string;
}
```

A context is a **set of (dimension, value) pairs**, hashed for identity. The universal context is the empty set.

## 18.2 v1 dimensions, and the ones that prove the point

Shipping: `jurisdiction`, `program`, `level`, `validFrom`, `validUntil`, `language`, `audience`.

Registrable without migration — and each is a case RFC-1 could not express:

| Dimension | Example | RFC-1 |
|---|---|---|
| `physicsRegime` | `F=ma` true Newtonian, false relativistic | ❌ |
| `musicTradition` | 12 semitones (Western) vs 22 shrutis (Hindustani) | ❌ |
| `organism` | true of mammals, false of plants | ❌ |
| `accountingStandard` | IFRS vs GAAP | ❌ |
| `languageVersion` | `print` is a statement in Python 2 | ❌ |
| `population` | paediatric vs geriatric dosing | ❌ |
| `conditions` | at STP | ❌ |

Seven dimensions RFC-1 would each have needed a migration for. Here, seven inserts.

## 18.3 Specificity lattice

Matching is unchanged in spirit from RFC-1 §16.5 — filter incompatible, rank by specificity, tie-break by trust level then version — but specificity is now computed over an open set using declared weights rather than counting fixed columns.

**Specificity still beats trust.** A CBSE-scoped simplification wins over a universal expert statement *for a CBSE student*, because they have an exam. The expert statement remains, and a `CONTRASTS` edge between them is exactly what an advanced learner should later be shown.

---

# 19. The Trust Architecture 🔒

*The correction to RFC-1's binary gate. The principle is unchanged: models propose, the platform decides, humans establish trust. What changes is that trust has levels, and effort scales sublinearly with knowledge.*

## 19.1 The ladder

| Level | Established by | Human effort | May be taught |
|---|---|---|---|
| `MACHINE_PROPOSED` | extraction only | none | internal R&D only, always labelled |
| `AUTO_VALIDATED` | deterministic validators pass (§19.3) | none | research exploration, labelled |
| `COMMUNITY_REVIEWED` | ≥N reputation-weighted reviewers agree | distributed | general learning, labelled |
| `EXPERT_REVIEWED` | a credentialed domain reviewer | expert | professional domains |
| `OFFICIAL_SOURCE_VERIFIED` | matches a designated authority (NCERT, WHO, statute) | verification only | **exam preparation** |
| `AGABI_CANONICAL` | Agabi editorial decision, typically resolving a conflict | highest | anything |

## 19.2 Admission is declared by the consumer, never by the data 🔒

```ts
interface TrustPolicy {
  minimum: TrustLevel;
  labelBelow: TrustLevel;      // anything under this is shown WITH its provenance
  refuseBelow: TrustLevel;     // never surfaced at all
}
```

| Use | Minimum | Rationale |
|---|---|---|
| CBSE exam preparation | `OFFICIAL_SOURCE_VERIFIED` | the exam marks one answer correct |
| Clinical/medical content | `EXPERT_REVIEWED` + authority | stakes |
| General school learning | `COMMUNITY_REVIEWED` | breadth matters, harm is bounded |
| Research exploration | `AUTO_VALIDATED`, labelled | the user is evaluating, not absorbing |
| Internal R&D | `MACHINE_PROPOSED`, labelled | no learner present |

**The invariant, which no policy may relax:**

> The platform never silently presents uncertain knowledge as fact. Anything below `labelBelow` is surfaced **with its trust level and provenance visible**, or not surfaced at all.

Silence about uncertainty is the failure mode, not the existence of uncertainty.

## 19.3 Scaling trust without scaling human work 🔒

The bottleneck was never review speed. It is the ratio of human attention to justified knowledge. Five mechanisms attack the denominator:

**1. Deterministic validators — zero human cost.** Quote containment in source (the gate that killed the fabricated nitrogen claim in RFC-1 Appendix A). Payload conformance. Unit and dimensional consistency. Numeric plausibility. Date coherence. Reference resolution. `AUTO_VALIDATED` means every applicable validator passed — a real epistemic state, not a placeholder.

**2. Cross-source agreement.** Three independent sources asserting the same proposition is genuine evidence. Independence is assessed by publisher, not by document — two NCERT editions are one source. Corroboration count is recorded and drives promotion.

**3. Contradiction detection against existing knowledge.** A new claim conflicting with `OFFICIAL_SOURCE_VERIFIED` knowledge in an overlapping context is flagged and cannot auto-promote. This makes the graph **self-defending**: the more verified knowledge exists, the more effectively it screens new claims. Human effort per statement *decreases* as the graph grows — the only property that makes 100M concepts conceivable.

**4. Inference over verified knowledge.** Transitive closure over `REQUIRES`. Symmetric and inverse relations. Type-constrained entailment. Derived statements inherit the trust level of their weakest premise and are marked `DERIVED` with the derivation recorded — checkable, not asserted.

**5. Reputation-weighted community review.** Reviewer reliability is measured by whether their approvals later survive dispute. High-reputation agreement reaches `COMMUNITY_REVIEWED` with fewer reviewers. This is why `ReviewEvent.actorId` and dispute outcomes must be captured from the first review — the reputation signal cannot be reconstructed later.

## 19.4 Every statement carries its epistemic state

```
trustLevel · validationMethods[] · corroborationCount · independentSourceCount
provenance[] · reviewHistory[] · reviewerIds[] · confidence · derivedFrom[]
contradictions[] · disputeHistory[]
```

Nothing here is a conclusion — every field is evidence about *how the belief came to be held*. Trust level is computed from them by a **promotion function**, which means improving that function reinterprets the whole graph instead of invalidating it.

## 19.5 Promotion and demotion

Promotion is automatic where the criteria are objective (`AUTO_VALIDATED`, corroboration counts) and human where they are not (`EXPERT_REVIEWED` and above).

**Demotion is automatic and immediate.** A contradiction raised, a source retracted, a dispute opened, a validator newly failing — all demote. Trust is not a ratchet. RFC-1's status machine allowed dispute; RFC-2 makes demotion a computed consequence rather than a manual act, because the failure mode is that nobody gets around to it.

---

*Part III specifies the Teaching Knowledge Layer — the layer RFC-1 lacked.*
