# Architectural clarification — derived educational properties

**This is not an amendment.** Nothing frozen changes. It records a decision about where a class of
properties lives, because the question keeps recurring and answering it once is cheaper than
re-litigating it per feature.

## The decision

Bloom level, confidence, difficulty, teaching priority and quality are **read-time computations of
the Inference Layer**. They are never columns on a canonical knowledge object.

Cites §10.1 (the knowledge object), L7 (curriculum is a separate mapping layer), L8 (inference is
derived, never authoritative).

## Why

A canonical knowledge object answers *what is asserted, and how do we know it*. Every property in
the list above answers something else:

| Property | What it actually depends on | Therefore |
|---|---|---|
| Bloom level | the **objective** a statement is being used for | a property of the mapping, not the statement |
| Difficulty | **who** is learning and what they already know | a property of the learner × statement pair |
| Teaching priority | observed demand, exam weight, leverage in the graph | changes daily; a stored value is stale on write |
| Confidence | trust level + corroboration + provenance | already fully determined by fields we store |
| Quality | the review history | already fully determined by the event log |

Storing any of them would create a second source of truth that drifts from the first. Confidence is
the sharpest case: a stored `confidence: 0.82` alongside
`trustLevel=MACHINE_PROPOSED, corroborationCount=0` is not extra information — it is a number that
can contradict the evidence it was supposedly derived from. ADR-2 exists to stop producers asserting
their own trust; a confidence column would reintroduce exactly that through the side door.

Difficulty and Bloom fail differently: they are not properties of the statement at all. "Is this
hard?" has no answer without a learner. Writing one onto the statement freezes an assumption about
an average student who does not exist.

## What this means in practice

- No migration adds these columns. A PR that proposes one is answered with this document.
- The Inference Layer computes them per request, from: `trustLevel`, `validationMethods`,
  `corroborationCount`, `independentSourceCount`, provenance, the review-event history, graph
  position (dependents, prerequisite depth), and the learner's observation record.
- Anything a report shows as "confidence" or "difficulty" must name the inputs it was computed from,
  in the same view. A bare score with no derivation is not evidence.

## The one place a number is stored

`corroborationCount` and `independentSourceCount` **are** stored — they are counts of things that
happened, not judgements about them. That is the line: **evidence is stored, conclusions are
computed.**
