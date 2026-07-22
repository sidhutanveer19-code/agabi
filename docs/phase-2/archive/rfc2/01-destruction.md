# RFC-2 · Part I — The Destruction

*Nothing is rebuilt in this part. Every claim in RFC-1 is attacked until it dies or proves itself.*

---

# 1. Method

An architecture is not justified by being coherent. RFC-1 is coherent. Coherence is what a wrong design feels like from the inside.

The only useful test is: **try to break it, and see what refuses to break.**

Ten claims carried RFC-1. Each is stated below as its author would state it, then attacked as an adversary would. Six die. Four survive, and survive differently than they were written.

The survivors, and only the survivors, become RFC-2.

---

# 2. Claim 1 — "The knowledge graph is the centre of the platform"

## 2.1 As stated

RFC-1 §9: five layers with the entity layer as "the fixed point of the entire system." Everything references the graph. Teaching consumes it. Mastery attaches to it.

## 2.2 The attack

**Teaching does not consume a graph. Teaching consumes explanations.**

Consider what actually makes a lesson good. Not the fact that photosynthesis produces glucose — every textbook has that, and a model already knows it. What makes it good is *the analogy that lands for a fifteen-year-old*, the worked example that anticipates the mistake they are about to make, the diagram that makes the light reaction obvious, the sentence that dissolves a specific confusion.

None of that is knowledge. All of it is **pedagogy**.

RFC-1 has no home for it. Search `01`–`11` for where "the best analogy for X, for a 15-year-old, in Hindi" is stored, and there is nowhere. RFC-1 stores what is **true**. It does not store what **teaches**. It built a knowledge base and called it a learning platform.

The consequence is brutal and specific: grounding a lesson in verified statements makes it *accurate*. It does not make it *good*. A perfectly grounded lesson can be dull, badly sequenced, and pitched wrong — and RFC-1's own success metric (§26.5, "grounded versus ungrounded lesson quality") would show no improvement, because accuracy was never the thing that was broken.

RFC-1 §4.7 raises this attack and answers it with "make it measurable." That is not an answer. That is agreeing to find out later that the premise was wrong.

## 2.3 Verdict: **DIES**

Knowledge is a **necessary input**, not the centre. The centre is what the learner receives and what the learner does. Knowledge, pedagogy, and evidence of performance are three peers, and RFC-1 modelled one of them.

---

# 3. Claim 2 — "Prerequisites form a DAG"

## 3.1 As stated

RFC-1 §20.2, marked 🔒 LOAD-BEARING: `REQUIRES` and `PART_OF` MUST be acyclic. Enforced on write, in CI, and operationally. A cycle is a page-worthy alert.

## 3.2 The attack

**This is false about human cognition, and it is the most confidently-wrong claim in RFC-1.**

Limits and derivatives. You cannot formally define a derivative without limits. But almost nobody understands limits properly until they have used derivatives — the intuition flows backwards. Every calculus teacher knows this. The dependency is genuinely mutual.

Vocabulary and reading. You acquire vocabulary by reading. You read by having vocabulary. There is no acyclic ordering; there is a spiral with a low-competence entry point.

Force and mass. `F = ma` defines both in terms of each other. Newtonian mechanics is a mutually-defining system, and it is taught by circling it repeatedly at increasing depth.

Grammar and meaning. Recursion and induction. Supply and demand. Structure and function in biology. The list is not exotic — it is most of what is hard to teach.

RFC-1 §3.6 claims prerequisites are one of the few *real* constraints, "a property of minds, not of curricula." Half right. The **existence of dependency** is real. The **acyclicity** is an artefact of wanting `topologicalSort()` to terminate.

RFC-1 imposed a data structure on cognition and then wrote three enforcement layers to defend the imposition. When reality produces a genuine cycle — and it will, on day one of Maths — the architecture will reject true knowledge and a reviewer will be forced to enter a lie to make the alert stop.

**That is the signature of a wrong model: it makes correct data unrepresentable.**

## 3.3 Verdict: **DIES**

Dependency is real, directional, and **graded**. Acyclicity is not. What is needed is a *readiness function* over a weighted, possibly-cyclic dependency network — not a topological sort. Cycles are legal; entry points are computed, not assumed.

---

# 4. Claim 3 — "VERIFIED is a binary gate, and only a human opens it"

## 4.1 As stated

RFC-1 §24.2, ADR-6, marked 🔒: one transition into `VERIFIED`, requiring a human actor. Enforced by test. §7.1 lists auto-approval as an **anti-goal** — forbidden forever, under any backlog pressure.

## 4.2 The attack

RFC-1 states the arithmetic itself (§42.3): 100M concepts requires **10,000 person-years** of verification. It writes that number down, calls it "a contribution problem," and proceeds as if the binary gate is compatible with the stated goal.

It is not. The two are in direct contradiction.

Under a binary human gate, the graph contains only what humans have personally checked. That is, permanently and by construction, **a rounding error against human knowledge**. The platform's answer for the other 99.99% is RFC-1 §2.6: fall back to `defaultOutline` and let the model invent — *which is exactly the ungrounded behaviour the entire phase exists to eliminate.*

So RFC-1's architecture guarantees that its own core failure mode remains the default path for almost every topic, forever.

Worse, the binary gate destroys real information. These are not the same epistemic object:

- a statement a human verified against NCERT
- a statement three independent sources agree on, unreviewed
- a statement one model proposed with a valid quote, unreviewed
- a statement one model proposed with no source

RFC-1 collapses all four into `PROPOSED` — untouchable, untaught, indistinguishable. It throws away the corroboration signal it already has.

And the stakes are not uniform. Teaching a hobbyist that a jazz chord voicing is usually written a certain way carries different risk from teaching a nursing student a drug dose. A single global gate cannot express that, so it must be set at the strictest level, which means the hobbyist gets nothing.

RFC-1 §5.4's premortem — "someone ships auto-approve to clear the backlog" — correctly identifies a real failure. Its countermeasure is to make the correct behaviour *impossible* rather than *graded*. That is not safety. That is a system that will be circumvented, because the alternative is a system that does nothing.

## 4.3 Verdict: **DIES**

Replaced by **graded confidence with stake-aware admission**. Confidence is a computed tier, not a human flag. The teaching layer declares the confidence floor it requires *for this learner, this domain, and these stakes.* Human review remains the highest tier and remains irreplaceable — it is no longer the only door, because a single door onto 10,000 person-years is a wall.

---

# 5. Claim 4 — "Context is a fixed seven-dimensional tuple"

## 5.1 As stated

RFC-1 §16: jurisdiction, program, level, validFrom, validUntil, language, audience. A row, hashed, with a unique constraint across all seven.

## 5.2 The attack

RFC-1 §3.2 argues, correctly and at length, that `subject` is not a universal abstraction — it is an institutional convention that varies by board, country and decade, and therefore must be *data*, not schema.

It then commits the identical error one section later. Seven dimensions, chosen in an afternoon, hard-coded as columns, with a unique constraint that makes adding an eighth a migration of the most-referenced table in the system.

The eighth dimension is not hypothetical:

| Domain | Dimension RFC-1 cannot express |
|---|---|
| Biology | **species/organism** — true of mammals, false of plants |
| Finance | **currency and accounting standard** — IFRS vs GAAP |
| Engineering | **material, tolerance regime, operating envelope** |
| Programming | **language version, runtime, platform** |
| Medicine | **patient population** — paediatric vs geriatric dosing |
| Physics | **regime** — Newtonian vs relativistic vs quantum |
| Chemistry | **conditions** — STP, temperature, pressure |
| Music | **tradition** — Western classical vs Hindustani |

That last row matters for Agabi specifically. "The octave divides into twelve semitones" is true in Western tuning and false in Hindustani classical, which uses 22 shrutis. RFC-1 would need a jurisdiction hack for a fact that has nothing to do with law.

**Physics regime** is the decisive case. `F = ma` is true, and false, and the difference is not jurisdictional, temporal, curricular, linguistic, or audience-related. RFC-1 has no honest way to say it.

The pattern: RFC-1 enumerated the dimensions its first dataset needed and froze them.

## 5.3 Verdict: **DIES**

Context is an **open, typed, extensible dimension set** with a declared specificity lattice — not a fixed tuple. Adding a dimension must be a registry entry, exactly as RFC-1 correctly argued for knowledge types (§13) and then failed to apply here.

---

# 6. Claim 5 — "Concepts are stable entities with permanent identity"

## 6.1 As stated

RFC-1 §14, §29, marked 🔒: a concept is a stable referent; identity is opaque and immutable; the test is "if everything we believe about X were wrong, would X still be the same thing?"

## 6.2 The attack

The claim conflates two different things, and the conflation is invisible until it is fatal.

**Reference stability** — a pointer, once issued, always resolves. Correct, cheap, keep it.

**Referent stability** — the *thing pointed at* is a fact about the world. **False.** Concept boundaries are drawn, not discovered.

Ask two biologists to atomise photosynthesis and you get different sets. Is "the light reaction" one concept or four? Is "chlorophyll" one concept, or chlorophyll-a and chlorophyll-b? Both answers are defensible, which means the boundary is a **convention**, not a fact.

RFC-1's own test fails on inspection. *"Atom"* in 1900 referred to an indivisible particle. That referent does not exist. Is modern "atom" the same concept? There is no fact of the matter — only a decision about whether to preserve the reference.

**The concrete failure:** RFC-1 supports **merge** (§27.5, with tombstones) and does not support **split**. Merge is the easy direction. Split is the one reality forces:

> A reviewer, eighteen months in, realises `c_energy` has been used for *kinetic energy* in Physics contexts and *energy* generally in Biology contexts. Two ideas, one node. Hundreds of statements, dozens of edges, and every mastery record are attached to a distinction that was never made.

Under RFC-1 this is unrecoverable. There is no split operation, the mastery records cannot be apportioned, and the statements must be re-reviewed individually against a distinction the original reviewer never had in mind. The tombstone mechanism runs the wrong way.

RFC-1 §5.2's premortem worries about duplication — two nodes that should be one. It never considers **conflation** — one node that should be two — which is strictly harder and at least as common, because it is invisible. A duplicate shows up in a similarity report. A conflation shows up as mastery behaving strangely, three years later.

## 6.3 Verdict: **SURVIVES, WOUNDED**

Reference stability survives and is load-bearing. Referent stability dies. **Split must be a first-class operation, designed for from the first row**, with statement re-attribution and evidence apportionment as explicit, reviewable steps.

---

# 7. Claim 6 — "Mastery attaches to concepts"

## 7.1 As stated

RFC-1 §2.4 and the `ConceptMastery` table: `(userId, conceptId)` as the identity of what a learner knows, deferred to Phase 3 but with its shape fixed now.

## 7.2 The attack

Nobody has ever observed mastery of a concept. What is observed is: **this learner, on this task, under these conditions, at this moment, succeeded or failed.**

"Mastery of photosynthesis" is an *inference* over such observations. It is a conclusion — and RFC-1 §2.4 states its own rule that conclusions are never stored, only evidence. It then creates a table whose primary key **is** the conclusion.

The damage is not theoretical:

- A learner who can answer a recall question but cannot apply the idea has *different mastery of the same concept*. `(userId, conceptId)` cannot represent that. Bloom level is part of the key, and RFC-1 puts it on the objective instead.
- Mastery decays. The key has no time dimension, so decay must be modelled elsewhere or lost.
- Transfer is contextual — mastery in a familiar frame does not imply mastery in an unfamiliar one. Not representable.
- Partial credit, misconception-specific failure, confidence-versus-accuracy: none representable.

RFC-1 fixed the *shape* of Phase 3's central object while explicitly declining to design Phase 3, on the grounds that designing against zero data produces guesses. The shape **is** the design, and it was guessed.

## 7.3 Verdict: **DIES**

The stored object is a **performance observation**: learner, task, context, outcome, timestamp, evidence. Mastery is a **query** over observations, computed by whatever model is current — which means improving the mastery model reinterprets all history instead of invalidating it. That is RFC-1's own stated principle, applied where RFC-1 failed to apply it.

---

# 8. Claim 7 — "Statements are the unit of knowledge"

## 8.1 As stated

RFC-1 §15: a versioned, contextual, sourced assertion, subject-predicate-object, with prose alongside.

## 8.2 The attack

Subject-predicate-object handles *"chlorophyll absorbs light energy."* It does not handle most of what is actually taught.

- **Conditional** — "if the discriminant is negative, the roots are complex." Two propositions and a relation between them.
- **Quantified** — "every continuous function on a closed interval attains its maximum." Universal quantification over an infinite domain.
- **Causal chain** — "increased CO₂ raises temperature, which raises sea level." Multi-step, with each link separately contestable.
- **Comparative** — "arteries have thicker walls than veins." Relational, not a property of either.
- **Probabilistic** — "smoking increases lung-cancer risk roughly twentyfold." A distribution, not a fact.
- **Procedural** — RFC-1 shoves this into a payload, so the *steps* are opaque to the graph and no prerequisite can point at step 3.
- **Definitional versus empirical** — "a prime has exactly two divisors" is true by definition; "the sky is blue" is true by observation. RFC-1 treats them identically, so it cannot tell a stipulation from a claim that evidence could overturn.

RFC-1 §15.5 defines contradiction as "same SPO, overlapping context, different object." Under that rule, *"every continuous function attains its maximum"* and *"some continuous function does not"* are not detected as contradictory, because neither fits the SPO shape at all.

The SPO core was adopted because it makes contradiction detection a SQL query. That is optimising the model for one convenient query.

## 8.3 Verdict: **SURVIVES, DEMOTED**

Assertions are real and must be versioned, contextual and sourced. **SPO is not their structure** — it is one *index* over a more general proposition, useful where it applies and absent where it does not. Proposition structure must be typed and extensible, like everything else that varies.

---

# 9. Claim 8 — "Postgres, behind an interface"

## 9.1 The attack

RFC-1 §30's reasoning is sound and its conclusion is right for the wrong reason. It justifies Postgres by traversal depth. The actual justification is stronger and simpler: **atomic multi-row writes with an auditable history are non-negotiable, and the workload is majority-relational.**

The genuine weakness RFC-1 missed: it puts the *canonical* store behind the interface but lets *pedagogical* and *evidence* data — which have completely different access patterns, retention rules and privacy obligations — sit in the same schema by default. Learner evidence is high-volume, append-only, privacy-regulated, and erasable. Knowledge is low-volume, append-only, public, and permanent. Coupling them is how a DPDP erasure request becomes a knowledge-graph incident.

## 9.2 Verdict: **SURVIVES, CORRECTED**

Postgres, behind an interface, with **knowledge and learner evidence in separate stores from the first migration** — not merely separate tables.

---

# 10. Claim 9 — "Human review is the bottleneck"

## 10.1 The attack

RFC-1 §3.7 identifies review throughput and optimises the review UI. Real, but one level too shallow.

**The actual bottleneck is that verification cost scales with knowledge volume while verification capacity is fixed.** No interface improvement changes the exponent. Doubling review speed halves a number that is still 10,000 person-years.

The bottleneck is therefore not *how fast a human reviews*. It is **how much can be known without a human reviewing it** — corroboration across independent sources, inference over already-verified knowledge, structural validation, and contradiction detection against the existing graph. Each of these produces justified belief at zero marginal human cost.

RFC-1 optimised the constrained resource. It never tried to need less of it.

## 10.2 Verdict: **DIES**

The bottleneck is **the ratio of human attention to justified knowledge**. Attack the denominator.

---

# 11. Claim 10 — "Curriculum is a mapping layer"

## 11.1 Verdict: **SURVIVES**

The strongest idea in RFC-1 and the one that survives the attack intact.

Knowledge exists independently; programs point at it; deleting every program leaves the graph whole. Generic `Program → nodes` with node kinds as data, rather than board/class/chapter. Tested by G1.

No successful attack was found. It is carried into RFC-2 unchanged, and it is the only load-bearing claim in RFC-1 that survives without amendment.

---

# 12. What is left standing

| # | Claim | Verdict |
|---|---|---|
| 1 | Graph is the centre | **DIES** — pedagogy and evidence are peers, not consumers |
| 2 | Prerequisites are a DAG | **DIES** — cognition is cyclic; readiness is computed |
| 3 | Binary human verification gate | **DIES** — graded confidence, stake-aware admission |
| 4 | Fixed 7-dimension context | **DIES** — open typed dimension registry |
| 5 | Stable concept referents | **WOUNDED** — reference stable, referent revisable; **split is first-class** |
| 6 | Mastery attaches to concepts | **DIES** — observations are stored; mastery is a query |
| 7 | Statements are SPO | **DEMOTED** — SPO is an index, not the structure |
| 8 | Postgres behind an interface | **CORRECTED** — knowledge and evidence in separate stores |
| 9 | Review throughput is the bottleneck | **DIES** — the ratio is the bottleneck; reduce the numerator |
| 10 | Curriculum is a mapping layer | **SURVIVES** |

One survivor. One wounded. One demoted. One corrected. Six dead.

## 12.1 Counter-attack — where the destruction was itself wrong

Two of the six kills did not survive review. Recorded here rather than quietly corrected, because a document that hides its own reversals is the thing this RFC exists to prevent.

### Claim 2 (DAG) — the attack was confused, not the claim

The attack conflated **knowledge structure** with **learning process**. They are different objects and the counter-argument is decisive.

*Knowledge* dependency is genuinely directional and genuinely acyclic. You cannot understand derivatives before functions, multiplication before addition, recursion before functions, or contract formation before offer and acceptance. These are real, stable, and rarely change.

*Learning* is iterative, spiralling and reinforcing. Optimisation deepens your grasp of functions. Cellular respiration illuminates photosynthesis. Debugging teaches programming.

The limits-and-derivatives example proves the counter-argument rather than the attack: `limits → derivatives` is a genuine `REQUIRES` edge, directional and acyclic. `derivatives → limits` is a **`REINFORCES`** edge — a different relationship entirely, and one that may legitimately cycle.

**Resolution — two graphs, not one relaxed graph:**

| | Knowledge Dependency Graph | Learning Reinforcement Graph |
|---|---|---|
| Edge | `REQUIRES` only | `REINFORCES`, `REVISITS`, `TRANSFER_TO`, `ENABLES`, `CO_OCCURS`, `COMMON_CONFUSION`, `ANALOGOUS_TO` |
| Cycles | **forbidden** | **permitted and expected** |
| Stability | rarely changes | evolves with evidence |
| Consumers | path planning, mastery gating, curriculum sequencing | revision, spaced retrieval, transfer, recommendation |

This is strictly better than the attack's proposal. It keeps deterministic curriculum planning — which a weighted cyclic network would have destroyed — while modelling how people actually learn. **Claim 2 is reinstated, scoped to `REQUIRES` only.**

### Claim 3 (verification gate) — the attack found the right problem and the wrong fix

The arithmetic in §4.2 stands: a single human door onto 10,000 person-years is a wall. But the proposed fix — letting computed confidence substitute for human establishment of trust — abandons the principle rather than scaling it.

The correct resolution keeps the principle intact and removes the bottleneck: **models propose, the platform decides, humans establish trusted knowledge** — with trust expressed as a **ladder of levels**, each with a defined validation method, rather than as a binary flag.

```
MACHINE_PROPOSED  →  AUTO_VALIDATED  →  COMMUNITY_REVIEWED
                  →  EXPERT_REVIEWED  →  OFFICIAL_SOURCE_VERIFIED
                  →  AGABI_CANONICAL
```

The Teaching Engine declares the minimum level it will accept for a given use. Exam preparation requires `OFFICIAL_SOURCE_VERIFIED` or above. Research exploration may surface lower levels **with explicit labelling**. Internal R&D may use `MACHINE_PROPOSED`.

The invariant that survives, and which the attack's version would have lost:

> **The platform never silently presents uncertain knowledge as fact.**

Human effort is reduced by deterministic validators, cross-source agreement, contradiction detection against existing knowledge, and reputation-weighted review — not by lowering the standard. **Scale trust, not manual work.** Claim 3 is reinstated in this form.

### Revised tally

| # | Claim | Final verdict |
|---|---|---|
| 1 | Graph is the centre | **DIES** — a Teaching Knowledge Layer is a peer (Part III) |
| 2 | Prerequisites are a DAG | **REINSTATED, SPLIT** — two graphs; only `REQUIRES` is acyclic |
| 3 | Binary verification gate | **REINSTATED, LADDERED** — six trust levels, principle intact |
| 4 | Fixed 7-dimension context | **DIES** — open typed dimension registry |
| 5 | Stable concept referents | **WOUNDED** — split is first-class |
| 6 | Mastery attaches to concepts | **DIES** — observations stored, mastery derived |
| 7 | Statements are SPO | **DEMOTED** — SPO is an index |
| 8 | Postgres behind an interface | **CORRECTED** — separate knowledge and evidence stores |
| 9 | Review throughput is the bottleneck | **DIES** — attack the ratio, not the rate |
| 10 | Curriculum is a mapping layer | **SURVIVES** |

Four dead, two reinstated in stronger form, one wounded, one demoted, one corrected, one intact.

The reinstatements matter more than the deaths. Both were cases where the attack correctly identified that something was wrong and incorrectly identified *what*. That is the normal outcome of red-teaming, and the reason destruction must be followed by argument rather than by immediate rebuilding.

RFC-1 was not shallow. It was **confidently wrong in six places**, and its confidence markers were themselves miscalibrated: four of the six deaths were marked 🔒 LOAD-BEARING.

That is the finding worth having. An architecture that marks its guesses as certainties is more dangerous than one that admits ignorance, because the marks are what future maintainers will trust.

---

*Part II rebuilds from what survived.*
