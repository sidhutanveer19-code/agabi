# AGABI Backend Phase 2 — Universal Knowledge Platform Architecture

## RFC Version 2

**Status:** Supersedes RFC-1 in full
**Method:** Adversarial. RFC-1 was attacked before RFC-2 was written.

---

## Why there is a Version 2

RFC-1 was coherent. Coherence is what a wrong design feels like from the inside.

Ten claims carried it. Each was attacked as an adversary would attack it. **Four died. Two were reinstated in stronger form after the attack itself proved wrong. One was wounded, one demoted, one corrected. One survived intact.**

The finding that justifies a rewrite rather than an edit: **four of the six fatal errors were marked 🔒 LOAD-BEARING in RFC-1.** The confidence markers were miscalibrated in exactly the places where miscalibration is most expensive, because those are the marks a future maintainer trusts.

## The six that changed

**Pedagogy was missing entirely.** RFC-1 modelled what is *true* and had nowhere to put what *teaches* — the analogy that lands, the misconception to pre-empt, the worked example that exposes the common error. Grounding makes a lesson accurate; accuracy is commodity. RFC-1's own success metric would have come back flat and the wrong conclusion drawn.

**One graph was doing two jobs.** Knowledge dependency is directional and acyclic. Learning is iterative and cyclic. RFC-1 forced both into one DAG, which made true data unrepresentable. RFC-2 separates them: `REQUIRES` stays acyclic, everything else may cycle.

**Trust was binary.** A single human door onto 10,000 person-years of verification is a wall. RFC-2 keeps the principle — models propose, the platform decides, humans establish trust — and expresses it as a six-level ladder with consumer-declared floors, so effort scales sublinearly while the standard never drops.

**Context was seven frozen columns.** `F = ma` is true Newtonian and false relativistic. Hindustani music divides the octave into 22 shrutis. Neither was expressible. Dimensions are now a registry.

**Mastery was a stored conclusion.** RFC-1 wrote the rule "store evidence, never conclusions" and then keyed its central Phase 3 object on a conclusion. Observations are stored; mastery is computed.

**Split did not exist.** Merge is easy. Discovering that one node was silently two ideas — with hundreds of statements and thousands of observations attached — is the operation reality forces, and RFC-1 could not perform it.

## Confidence markers

🔒 **LOAD-BEARING** — reversing requires migrating live data. Change only with a written migration plan.
⚖️ **CONSIDERED** — real decision, real alternatives, reversible at moderate cost.
🔬 **PROVISIONAL** — an informed guess that has not met reality. Expect change.

§29.2 lists every remaining guess and the phase that resolves it. None is marked load-bearing.

---

## Contents

**Part I — The Destruction** (`01-destruction.md`)
The attack on RFC-1. Ten claims, ten verdicts, and a counter-attack recording where the destruction was itself wrong.

**Part II — Foundations** (`02-foundations.md`)
Six irreducibles. The two-graph model. Identity and split. Context as a registry. The trust architecture.

**Part III — The Teaching Knowledge Layer** (`03-teaching-layer.md`)
The layer RFC-1 lacked. Asset kinds, misconceptions, analogies with mandatory breakdown points, and how the future Teaching Engine consumes them.

**Part IV — Observation, Physical Design, and Build** (`04-observation-and-build.md`)
Observations and mastery-as-query. Three stores. Testing invariants. Roadmap 2A–2F. Decision records.

---

## The one-paragraph version

Agabi stores nothing about what it teaches — `defaultOutline(topic)` is string templating, and the model invents every lesson. Phase 2 fixes that by extending Phase 1's invariant from state to knowledge: models propose, the platform decides, humans establish trust. Knowledge is concepts (stable identity) plus propositions (versioned, contextual, sourced, trust-rated), arranged in two graphs — an acyclic dependency graph for planning and a cyclic reinforcement graph for how learning actually works. Alongside it sits a teaching layer holding what no textbook contains and no model reliably knows: the misconceptions learners actually form, the analogies that land, and where those analogies break. Curricula map onto knowledge and own none of it. Learner observations live in a separate store, and mastery is a query over them rather than a number in a row. What compounds is the loop: teaching produces observations, observations reveal misconceptions and measure which explanations work, and the platform learns how to teach.
