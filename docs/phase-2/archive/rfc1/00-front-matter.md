# AGABI Backend Phase 2 — Universal Knowledge Platform Architecture

**Status:** Draft for review
**Phase:** Backend Phase 2
**Supersedes:** nothing. Extends Phase 1 (Conversation Architecture) and Phase 2-Observability (Evidence Spine).
**Audience:** engineers implementing the platform; future maintainers deciding whether a change is permitted.

---

## How to read this document

This specification is long because the decisions in it are expensive to reverse. It is not uniformly authoritative. Every section carries one of three confidence markers, and you should treat them differently.

| Marker | Meaning | How to treat it |
|---|---|---|
| **🔒 LOAD-BEARING** | Reversing this requires migrating live data, student history, or every reference in the graph. Decided deliberately; change only with a written migration plan. | Do not deviate. |
| **⚖️ CONSIDERED** | A real decision with real alternatives, made on evidence available today. Reversible at moderate cost. | Deviate only with a documented reason. |
| **🔬 PROVISIONAL** | An informed guess that has not met reality. Made because the system needs *an* answer, not because this is known to be the right one. | Revisit after the first 200 verified concepts. Expect to change. |

The document deliberately marks its own weak points. A specification that presents every decision with equal confidence is lying about at least some of them.

### Load-bearing sections, in order of irreversibility

1. **§29 IDs** — identity can never be changed once referenced.
2. **§27 Versioning** — immutability must exist from the first row or history is unrecoverable.
3. **§28 Provenance** — cannot be backfilled; a concept without a source is unverifiable forever.
4. **§16 Context Model** — contextual truth cannot be retrofitted onto unscoped statements.
5. **§14/§15 Concept and Statement separation** — merging or splitting these later rewrites every edge and every mastery record.

Everything else can be rebuilt.

---

## Conventions

- **MUST / MUST NOT / SHOULD / MAY** carry RFC 2119 meaning.
- Code identifiers in `monospace` refer to real or specified modules. Where a module already exists in the repository, its path is given as a link (`src/server/...`).
- Diagrams are Mermaid or ASCII. Both render in the produced PDF.
- **ADR-n** blocks are Architecture Decision Records: context, decision, alternatives, consequences.
- "The graph" means the logical knowledge model. "The store" means whatever physically persists it. These are deliberately different words throughout — see §30.

---

## Table of contents

**Part I — Foundations** (`01-foundations.md`)
1. Vision
2. Philosophy
3. First-Principles Analysis
4. Red-Team Analysis
5. Premortem
6. System Goals
7. Non-Goals

**Part II — Architecture** (`02-architecture.md`)
8. Overall Backend Architecture
9. Universal Knowledge Platform
10. Platform Engineering
11. Content Engineering

**Part III — The Knowledge Model** (`03-knowledge-model.md`)
12. Universal Knowledge Graph
13. Knowledge Object Model
14. Concept Model
15. Statement Model
16. Context Model
17. Skill Model
18. Learning Objective Model
19. Assessment Model
20. Relationship Model

**Part IV — Surrounding Layers** (`04-layers.md`)
21. Curriculum Layer
22. Source Layer
23. Validation Layer
24. Review Layer

**Part V — Access** (`05-access.md`)
25. Search Architecture
26. Retrieval Architecture
32. APIs
33. Query Model
34. Traversal Engine

**Part VI — Identity, Time and Truth** (`06-identity-time.md`)
27. Versioning Architecture
28. Provenance
29. IDs
38. Knowledge Evolution

**Part VII — Physical** (`07-physical.md`)
30. Storage
31. Indexing
42. Scaling to 100M+ Concepts

**Part VIII — Content Operations** (`08-content-ops.md`)
35. Knowledge Ingestion Pipeline
36. Human Review Workflow
37. Research Connectors

**Part IX — Assurance** (`09-assurance.md`)
39. Migration Strategy
40. Security
41. Privacy
43. Failure Modes
44. Testing Strategy
45. Operational Strategy

**Part X — Forward** (`10-forward.md`)
46. Future AI Integration
47. Phase-by-Phase Implementation Plan

**Appendices** (`11-appendices.md`)
- A. Worked example: photosynthesis, end to end
- B. Worked example: contract law across jurisdictions
- C. Worked example: a piano skill
- D. Complete Prisma schema
- E. Glossary
- F. Decision record index
