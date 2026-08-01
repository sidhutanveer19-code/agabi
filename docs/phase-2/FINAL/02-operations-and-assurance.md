# Part III — Operations, Trust, Assurance

---

# 19. Versioning Strategy 🔒

Nothing is overwritten. Editing creates a row; the old becomes `DEPRECATED` and stays readable forever.

*Why not mutate-plus-audit-log:* reconstructing old state means replaying the log backwards — fragile and slow. *Why not temporal tables:* Postgres-specific, violating engine independence.

| Entity | Versioned | Note |
|---|:-:|---|
| Concept | yes | rare — identity is stable by design |
| Statement | **yes** | the common case |
| Dependency / Composition / Reinforcement edge | yes | reinforcement increasingly *earned* |
| TeachingAsset | **yes** | assets improve; old ones must replay |
| AssessmentItem | yes | |
| Mapping | yes | syllabi change between editions |
| ConceptTag / ConceptAlias | **no** | additive; history in `ReviewEvent` |
| Context | **no** | immutable by construction — id is its hash |
| Observation | **no** | an append-only fact about a moment |

**Trust level is versioned with the row.** *"Was this `OFFICIAL_SOURCE_VERIFIED` when we taught it in March?"* must be answerable; a mutable trust column would make every historical trust claim unverifiable.

**Releases** pin exact version ids. Every lesson records its release, so a 2029 replay of a 2026 lesson resolves every statement and asset to the version the learner actually saw.

---

# 20. Knowledge Evolution Strategy

## 20.1 Five kinds of change

| Change | Mechanism | History |
|---|---|---|
| Correction — it was wrong | new version, old `DEPRECATED` | full |
| Refinement — it was imprecise | new version | full |
| **Supersession — reality moved** | new statement; old gets `validUntil` | **both current** |
| Retraction — affirmatively false | `RETRACTED`, no replacement | retained, marked |
| Reclassification | tag update | `ReviewEvent` |

Supersession is **not** correction. The 2018 hypertension guideline was not wrong in 2018. Deprecating it falsifies history; a `validUntil` records the truth.

## 20.2 Mastery is a query 🔒

```ts
mastery(learnerId, conceptId, atBloom?, asOf?) → MasteryEstimate
```

Computed from observations by whatever model is current. Improving from naive percentage to Bayesian knowledge tracing **reinterprets all history** instead of invalidating it. A stored mastery row could not have been recomputed.

Representable as a result: mastery at recall but not application, decay over time, transfer failure, misconception-specific failure, confidence versus accuracy. None of these fit `(userId, conceptId)`.

## 20.3 Merge and split

**Merge** — move aliases, tags, statements, all three edge kinds, assets and mappings to the winner; tombstone the loser with `mergedInto`; the loser's id resolves forever. Non-destructive, which is what makes reviewers willing to do it.

**Split** 🔒 — the direction reality forces. A reviewer discovers `c_energy` has meant *kinetic energy* in Physics contexts and *energy generally* in Biology contexts.

```
split(sourceId, [targetA, targetB], plan):
  1. create targets
  2. re-attribute each statement       (per item, or by context rule)
  3. re-attribute each edge            (all three graphs)
  4. apportion observations            BY THE CONTEXT ON EACH OBSERVATION
  5. tombstone source with splitInto[] → resolution becomes AMBIGUOUS
  6. ReviewEvent records the full plan
```

Step 5 is honest rather than convenient: after a split, an old reference resolves to *two* things, and any reference that did not record its usage context is genuinely ambiguous. **This is why every concept reference carries `contextId`** — one column now, unrecoverable later.

## 20.4 Cascading review

A changed statement flags: assessment items evidencing its concept, statements citing it, teaching assets teaching it, mappings at `MASTER` depth. Flagged means queued — a human decides. **Lessons already taught are never retroactively changed.**

## 20.5 Source deprecation

A withdrawn source demotes statements sourced *only* from it to `DISPUTED`. Statements with independent corroborating provenance are unaffected — the concrete payoff of allowing multiple provenance rows.

---

# 21. Migration Strategy

## 21.1 Into the platform

Nothing to migrate; Agabi stores no knowledge. Phase 2 is additive: new tables, a second database, one changed call site.

**Rollback stays trivial through M0–M7:** revert `startLesson` to `defaultOutline(topic)`. Knowledge tables go inert. No data loss.

## 21.2 Migrations the architecture prevents

| Would-be migration | Prevented by |
|---|---|
| add a context dimension | open registry |
| add a knowledge / asset / item type | registries |
| add a trust level | ladder is data |
| separate prerequisite from reinforcement | three tables already |
| add pedagogy | L4 exists |
| recompute mastery under a better model | mastery is a query |
| split a conflated concept | first-class; references carry context |
| add a curriculum | mapping layer |
| add a tenant | `scope` from row one |
| erase a learner without touching knowledge | separate stores |
| recover overwritten knowledge | never overwritten |
| backfill provenance | mandatory from row one |
| add difficulty semantics | never stored |
| rename after reclassification | opaque ids |

Fourteen migrations prevented by decisions that cost nothing today. **This table is the phase's actual deliverable** — it is what "no redesign required" means concretely.

## 21.3 Migrations that will legitimately happen

Authored reinforcement edges → earned. Trigram → vector. Misconception payload → first-class concept. Observation partitioning. Traversal engine as a derived store. All additive; none re-authors content.

---

# 22. Scaling Strategy

| Concepts | Statements | Assets | Observations | Architecture |
|---|---|---|---|---|
| 10² | 10³ | 10² | 10³ | single instance |
| 10⁴ | 10⁵ | 10⁴ | 10⁶ | + closure cache |
| 10⁶ | 10⁷ | 10⁶ | 10⁹ | + read replica, search index, observation partitioning |
| 10⁸ | 10⁹ | 10⁸ | 10¹² | + partitioning, + traversal engine if measured |

Observations dominate by three orders of magnitude — which is why they are a separate store with independent partitioning and retention.

**Nothing in the logical model changes at any step.** Every change is additive and operational.

**The real constraint is not technical.** 100M concepts is 10,000 person-years of verification. Reaching it is a *contribution* problem: federated review, reputation weighting, and accepting bulk knowledge at lower trust tiers. The architecture supplies the primitives (`ReviewEvent.actorId`, trust levels, `scope`); the workflow is out of scope and §34 records it as deferred.

---

# 23. Multi-Tenancy Strategy

`scope` on every knowledge row: `PUBLIC` or `tenant:<id>`.

| Rule | Enforcement |
|---|---|
| tenant knowledge is visible only within its tenant | filter applied **inside `KnowledgeStore`**, never by callers |
| tenant knowledge MAY reference public concepts | one-way; validated by V13 |
| public knowledge MUST NOT reference tenant knowledge | V13; a violation is a security alert |
| a tenant may not read another tenant | store-level; conformance-tested |
| observations are tenant-scoped | separate store, same rule |

Enforcement lives in the store because caller-side filtering is one forgotten `where` clause away from a leak. The conformance suite includes a two-tenant fixture asserting zero cross-visibility across every read method.

Phase 2 ships the field and the enforcement. Tenant administration, billing and onboarding are out of scope.

---

# 24. Research Connector Architecture

```ts
export interface SourceConnector {
  id: string;
  kinds: SourceKind[];
  license(ref: string): Promise<LicenseInfo>;   // called BEFORE fetch
  fetch(ref: string): Promise<{ source: RawSource; bytes: Buffer }>;
  rateLimit?: RateLimitPolicy;
}
```

`license()` runs first and can **refuse ingestion**. Unknown licence requires explicit human approval before fetch.

| Connector | Kind | Licence posture | Phase |
|---|---|---|---|
| local filesystem (PDF/MD/HTML) | manual | operator asserts | M1 |
| NCERT PDFs | book | ⚠️ free download ≠ free reproduction | M1 |
| Government curriculum | dataset | usually permissive | M6 |
| Wikipedia / Wikidata | web | CC-BY-SA — attribution obligations | later |
| OpenStax | book | CC-BY | later |
| arXiv / PubMed | paper | mixed | later |
| Web crawler | web | ⚠️ per-domain assessment | later |

**Binding invariant:** research never writes to the graph. Every connector produces `MACHINE_PROPOSED` knowledge into the identical pipeline. There is no privileged path and no trusted publisher — a connector cannot weaken the trust guarantee because promotion is a separate, gated process.

---

# 25. Review Pipeline

## 25.1 Throughput is the design target

| Approach | Rate |
|---|---|
| individual cards, no source | ~60/hr |
| **batched, source in view, quote highlighted** | ~200/hr |
| + auto-reject filtering | ~250/hr |
| + leverage ordering (usable at 40% coverage) | effective 2× |

The gap between row 1 and row 4 is the gap between a project that finishes and one that does not.

## 25.2 The batch screen

Source passage on the left with the quote highlighted in place; ~8 proposals on the right; approve-all is one keystroke; rejection is per item.

Three properties make it fast: the passage is read once for eight decisions; verification is by *comparison* rather than recall (possible only because of span-preserving cleaning and the char range from V3); and the common case — extraction is mostly right — is one action.

## 25.3 Queue ordering

```
priority = w₁·dependentCount      // leverage: errors here propagate
         + w₂·knowledgeMissCount  // real student demand
         + w₃·programWeight       // exam importance
         − w₄·ageInQueue          // starvation guard
```

`knowledgeMissCount` comes from the evidence log. **Review follows observed demand, not curriculum order** — which is what makes the first 200 concepts disproportionately valuable.

## 25.4 Never asked of a reviewer

Assign difficulty (does not exist) · assign an id (machine-minted) · write from scratch (they edit) · check quote presence (machine) · check payload shape (machine) · find duplicates (machine-surfaced) · judge more than ~8 items per screen.

Human attention is spent only on judgment: is it true, is it well-stated, is it the right shape, is the wording original, and — for V9 — is this a prerequisite or a reinforcement.

---

# 26. Trust Model 🔒

## 26.1 The ladder

| Level | Established by | Human effort | Teachable to |
|---|---|---|---|
| `MACHINE_PROPOSED` | extraction | none | internal R&D only, labelled |
| `AUTO_VALIDATED` | all applicable validators pass | none | research exploration, labelled |
| `COMMUNITY_REVIEWED` | ≥N reputation-weighted reviewers | distributed | general learning, labelled |
| `EXPERT_REVIEWED` | credentialed domain reviewer | expert | professional domains |
| `OFFICIAL_SOURCE_VERIFIED` | matches a designated authority | verification | **exam preparation** |
| `AGABI_CANONICAL` | editorial decision, typically resolving a conflict | highest | anything |

## 26.2 Promotion is a deterministic function

```
promote(s) =
  AGABI_CANONICAL           if editorial ReviewEvent
  OFFICIAL_SOURCE_VERIFIED  if ReviewEvent by verifier AND authority ∈ designated
  EXPERT_REVIEWED           if ReviewEvent by credentialed expert
  COMMUNITY_REVIEWED        if Σ(reviewer reputation) ≥ threshold
  AUTO_VALIDATED            if all applicable validators pass
                            AND independentSourceCount ≥ 1
                            AND no OPEN contradiction with a higher-trust statement
  MACHINE_PROPOSED          otherwise
```

**Anything above `AUTO_VALIDATED` requires a `ReviewEvent` with a human `actorId`.** No exception, no threshold, no override. Enforced by test.

## 26.3 Demotion is automatic and immediate

A raised contradiction, a retracted source, an opened dispute, or a newly-failing validator demotes within one job cycle. **Trust is not a ratchet.** The failure mode being prevented is that nobody gets around to it.

## 26.4 Admission is declared by the consumer

```ts
interface TrustPolicy { minimum: TrustLevel; labelBelow: TrustLevel; refuseBelow: TrustLevel }
```

Exam prep: `OFFICIAL_SOURCE_VERIFIED`. Clinical: `EXPERT_REVIEWED` + authority. General school: `COMMUNITY_REVIEWED`. Research: `AUTO_VALIDATED`, labelled. R&D: `MACHINE_PROPOSED`, labelled.

**The invariant no policy may relax:**

> The platform never silently presents uncertain knowledge as fact.

## 26.5 `DISPUTED` — a suspension, not a level (F6)

`DISPUTED` is referenced by source deprecation (§20.5) and by demotion (§26.3). It is **not a rung on the ladder** — it is an orthogonal **suspension flag**, and conflating the two would be a modelling error.

```prisma
disputed        Boolean  @default(false)
disputeReason   String?
disputedAt      DateTime?
priorTrustLevel String?    // the level to restore on resolution
```

| Property | Behaviour |
|---|---|
| Effect | **not teachable at any trust level** while `disputed = true` |
| Trust level | **preserved**, not reset — a disputed `OFFICIAL_SOURCE_VERIFIED` statement is still official, merely suspended |
| Raised by | any reviewer, automatic contradiction detection, or source deprecation |
| Resolved by | `APPROVE` (restore `priorTrustLevel`), `EDIT` (new version, dispute cleared), or `RETRACT` (permanent) |
| Visibility | always visible in review; never returned to a learner regardless of `TrustPolicy` |

**Why a flag rather than a level.** Making it a level would destroy the record of *what the statement was trusted at before the dispute*, so resolution would have to re-establish trust from scratch — turning every dispute into a full re-verification. As a flag, resolution is one decision and the prior standing is intact.

`TrustPolicy` cannot admit a disputed statement. There is no `minimum` low enough, because the flag is checked before the level.

## 26.6 Scaling trust without scaling work

Deterministic validators (zero cost) · cross-source agreement by *publisher* independence, not document · **contradiction detection against verified knowledge, which makes effort per statement fall as the graph grows** · inference with recorded derivation, inheriting the weakest premise's level · reputation-weighted community review.

---

# 27. Security Model

| Threat | Mitigation |
|---|---|
| **Prompt injection in a source document** | the extractor's return type **has no trust field** — a model cannot express verification. Structurally impossible, not filtered. |
| Knowledge poisoning | human review above `AUTO_VALIDATED`; extraction output is data, never instructions |
| Unauthorised promotion | role check + `actorId` on every `ReviewEvent` |
| Tenant leakage | store-level filter, conformance-tested (§23) |
| Source spoofing | `Source.checksum`; connector fetch metadata |
| Destructive write | no delete methods exist on `KnowledgeStore` |
| Review flooding | halt conditions; per-source rate limits |

**Roles:** `reader` (trusted public knowledge) · `reviewer` (see `PROPOSED`; approve/reject/edit/merge/split) · `ingestor` (run pipelines) · `admin` (releases, source deprecation, vocabulary). **No role writes above `AUTO_VALIDATED` outside `applyReview`.** `admin` is not a superuser over truth.

## 27.1 Copyright — a launch gate

Facts are not protectable; expression is. NCERT is free to download, not to reproduce.

`statement.text` is **written, not copied** (V5 flags substring-of-quote). The verbatim quote lives only in `Provenance`, is used only for verification, and is **never served** — conformance-tested. `Source.license` recorded per document; connectors refuse incompatible licences.

## 27.2 Privacy — a launch gate

Knowledge contains no personal data; observations do. They are **separate stores**, so a DPDP erasure request cannot damage the knowledge graph. India's DPDP Act requires verifiable guardian consent for under-18s — unresolved, and gating public launch alongside copyright.

---

# 28. Observability Integration

Phase 2 consumes the existing evidence spine rather than duplicating it.

| Concern | Owner |
|---|---|
| what happened during a lesson | evidence spine |
| which concepts/versions/release a lesson used | evidence spine (`lesson.grounded`) |
| which extractor and prompt produced a proposal | knowledge provenance — **permanent** |
| who promoted a statement and when | `ReviewEvent` — **permanent** |
| topic had no knowledge / no assets | `knowledge.miss` / `teaching.miss` |

**Rule:** operational history may age out; knowledge provenance may never.

**Health providers** registered with the existing framework, each returning real status or `NOT_INSTALLED` — never a green light for something absent:

| Provider | `UP` | `DEGRADED` | `UNSAFE` |
|---|---|---|---|
| knowledge-store | reachable, p95 in budget | latency high | unreachable |
| knowledge-integrity | 0 cycles, 0 missing provenance | duplicate rate above threshold | **cycle present or provenance missing** |
| trust-pipeline | promotions moving | backlog growing | promotion above `AUTO_VALIDATED` without a `ReviewEvent` |
| ingestion | healthy | backlog growing | halted |
| observation-store | reachable | lag | unreachable |

`knowledge-integrity` at `UNSAFE` means the graph asserts things it cannot justify. **Teaching degrades to ungrounded rather than serving unjustifiable knowledge.**

**Metrics, each with a decision attached:** concepts verified/hour · queue depth and age · duplicate rate · grounding rejection rate · golden-set precision/recall · `knowledge.miss` by topic · grounded vs asset-supported vs ungrounded lesson quality · dependency-closure p95 · cycle count (must be 0) · statements without provenance (must be 0) · promotions lacking a `ReviewEvent` (must be 0).

---

# 29. Testing Strategy

**Standing invariants over data**, not unit tests of code:

| Test | Asserts | Guards |
|---|---|---|
| `dependency-dag` | `REQUIRES` acyclic | S12 |
| `composition-dag` | `PART_OF` acyclic | C2 |
| `reinforcement-cycles-pass` | cycles there **do not fail** | premortem 5 |
| `graph-conflict` | no pair in both dependency and reinforcement, same direction | §11.5 |
| `grounding` | quote literally in source for everything above `MACHINE_PROPOSED` | S4 |
| `provenance` | every statement above `MACHINE_PROPOSED` has provenance | S4 |
| `trust-gate` | no promotion above `AUTO_VALIDATED` without a human `ReviewEvent` | 26.2 |
| `trust-demotion` | contradiction demotes within one cycle | 26.3 |
| `no-silent-uncertainty` | nothing below `labelBelow` returned unlabelled | S3 |
| `analogy-breakdown` | every `ANALOGY` has a breakdown point | 13.3 |
| `split-resolvable` | every concept reference records usage context | 20.3 |
| `identity` | no FK targets `slug`; `Concept.id` never updated | S11 |
| `no-delete` | no destructive path | S5 |
| `store-separation` | no query joins knowledge and observation | 17.1 |
| `tenant-isolation` | two-tenant fixture, zero cross-visibility | S15 |
| `curriculum-independence` | drop all programs, graph still teachable | S1 |
| `empty-platform` | full suite green on zero rows | S10 |
| `context-canonical` | identical dimension sets hash identically | C5 |
| `conformance` | any store implementation passes | S9 |
| `quote-never-served` | no student-facing response contains `Provenance.quote` | 27.1 |

**Determinism:** identical bytes → identical chunk ids; fixed graph → identical closure order; table-driven context matching; snapshot path selection.

**Golden set:** one chapter hand-authored as ground truth. Every extractor, prompt, chunk-size or model change is scored on precision, recall, grounding rate, duplicate rate. Without it, *"the extractor improved"* is an opinion.

---

# 30. Risk Analysis

| # | Risk | Severity | Detection | Mitigation |
|---|---|---|---|---|
| R1 | **content never populated** | terminal | coverage flat | graceful degradation; miss-driven priority; M3 is one chapter end to end |
| R2 | trust ladder gamed by volume | high | promotion vs review rate | contradiction gate; publisher-level independence; halt conditions |
| R3 | **silent conflation** | high, **silent** | mastery anomalies, late | split first-class; usage context on every reference; scheduled conflation report |
| R4 | silent duplication | high, silent | similarity report | aliases; dedupe stage; merge queue; standing metric |
| R5 | prerequisite/reinforcement misclassified | high | learners blocked or mis-sequenced | V9 always human-confirmed |
| R6 | grounded-looking nonsense | high | golden set | V3 machine-checked, never model-judged |
| R7 | bad teaching asset installs a misconception | high | efficacy, late | mandatory breakdown point; trust ladder applies to assets |
| R8 | copyright | terminal | – | written not copied; quotes never served; licence per source; legal gate |
| R9 | DPDP / minors | terminal | – | separate store; `purgeUser`; legal gate |
| R10 | uncertain shown as fact | severe | `no-silent-uncertainty` | labelling invariant, tested |
| R11 | DAG check overreaches | medium | reinforcement cycles fail CI | dedicated pass-test |
| R12 | grounding does not help | strategic | M5 vs M7 | falsifiable prediction; stop if 2D also flat |
| R13 | tenant leakage | terminal | conformance | store-level filter |

**R3 is the one to fear:** silent, compounding, visible only years later as inexplicable mastery behaviour.

---

# 31. Red Team Analysis

*Ten claims attacked. Four died, two were reinstated after the attack itself proved wrong, one wounded, one demoted, one corrected, one intact. Four of the six original deaths had been marked LOAD-BEARING — the confidence markers were miscalibrated exactly where it costs most.*

| Attack | Outcome |
|---|---|
| "You will never fill it" | **stands** — R1, mitigated by degradation and demand-driven review |
| "Extractor produces confident nonsense" | mitigated — V3 machine-checked, golden set, revisable trust |
| "Global concepts fill with duplicates" | mitigated — aliases, dedupe, merges, standing metric |
| "Identity encodes meaning and lies" | **prevented** — opaque ids, mutable slugs, tags |
| "Context is over-engineering" | **rejected** — the school case uses one row of nulls; retrofitting is an unanswerable question about every historical row |
| "Postgres collapses at 100M" | mitigated — shallow traversal, closure cache, store interface |
| "Nobody uses it, teaching is fine" | **partly landed** — produced L4; grounding alone was never the differentiator |
| "You are storing copyrighted text" | mitigated — §27.1, legal gate |
| "Prerequisites aren't acyclic" | **defeated** — knowledge dependency vs learning process; three graphs |
| "Binary gate is arithmetically impossible" | **landed** — trust ladder |
| "Mastery on (user, concept) stores a conclusion" | **landed** — observations + query |
| "Statements-as-SPO can't express most knowledge" | **landed** — seven forms, SPO is one index |

---

# 32. Premortem

**1 · The platform was finished and the product never was.** 600 concepts; teaching still `defaultOutline` for 95% of topics. → M3 is one chapter and M5 is student-visible; every milestone asks "can a student see this?"

**2 · The trust ladder became a loophole.** Under coverage pressure the exam floor was quietly lowered. Nothing broke visibly; students learned wrong things and blamed themselves. → trust policy is code, reviewed and tested; lowering a floor is a diff; `no-silent-uncertainty` fails CI.

**3 · Silent conflation.** `c_energy` meant two things for years; mastery transferred where it shouldn't. → split designed; usage context recorded; scheduled report for concepts whose statements cluster into disjoint context groups.

**4 · The teaching layer stayed empty.** L4 shipped as schema; coverage always looked more urgent; lessons were accurate and forgettable; grounding showed no benefit and was read as "the platform doesn't help." → M7 precedes the expensive breadth work of M9, and the prediction in §33.1 is stated in advance so the result is not misread.

**5 · The graphs were re-unified "for simplicity".** The DAG check began failing on legitimate reinforcement cycles, so it was disabled; six months later prerequisites contained cycles and path planning silently produced nonsense. → W6/W7 import rules plus a test asserting reinforcement cycles pass.

**6 · Legal.** Verbatim text in a public database; minors' observations without consent. → §27, both gating launch.

**7 · Never proven to help.** Nobody measured; allocation became opinion; the graph lost to features with visible metrics. → grounded / asset-supported / ungrounded recorded per lesson; the comparison is a query.

---

# 33. Future Extension Strategy

| Future need | Extension | Cost |
|---|---|---|
| new domain (medicine, law, music) | register context dimensions + knowledge kinds | inserts |
| new curriculum / board / exam | Program + ProgramNode + Mapping rows | inserts |
| new relationship semantics | reinforcement `type` value | insert |
| new teaching modality | asset kind | insert |
| new assessment format | item kind | insert |
| semantic search | rung 4 behind `resolve()` | one module |
| graph engine | second `KnowledgeStore` | one module |
| federated contribution | reputation over existing `ReviewEvent.actorId` | new service, no schema change |
| AI-generated knowledge at scale | enters as `MACHINE_PROPOSED`; ladder unchanged | none |
| multimodal sources | new `SourceConnector` + parser | one module |

**Nothing in this table requires a schema migration to a core table.** That is the operational definition of "no redesign required."

## 33.1 The falsifiable prediction

Grounding alone (M5) produces a **small** accuracy gain and **no** perceived-quality gain. The large gain arrives with M7, when misconceptions and analogies enter. Stated in advance so it can be wrong. If M7 is also flat, the thesis is wrong and the plan must change.

---

# 34. Deferred Decisions

| # | Decision | Deferred because | Resolved by | Default until then |
|---|---|---|---|---|
| D1 | single-pass vs four-pass extraction | needs golden-set measurement | M3 | four-pass |
| D2 | dedupe similarity threshold | needs observed false/missed merge rates | M6 | 0.85, never auto-merge |
| D3 | closure cache invalidation granularity | needs observed edge-write patterns | M6 | clear all on review commit |
| D4 | community review quorum N | needs reviewer reputation data | post-M6 | expert-only |
| D5 | assessment item calibration model | needs response data | Phase 3 | store evidence only |
| D6 | which teaching asset kinds beyond three | needs efficacy data | post-M7 | three kinds |
| D7 | reinforcement edge strength derivation | needs observation volume | Phase 3 | authored, `earned=false` |
| D8 | federated contribution workflow | needs contributors > 1 | when true | single reviewer |
| D9 | vector search adoption | needs rung-3 failure evidence | when measured | rungs 1–3 |
| D10 | traversal engine adoption | needs p95 > 50 ms with cache | when measured | Postgres |

**Every deferred decision has a default, a trigger and a resolver.** None blocks implementation, and none is load-bearing — which is the correction to RFC-1's most dangerous property.

---

# 35. Final Architecture Review

*The criteria this document must pass to be frozen. Each is checkable, not rhetorical.*

| # | Criterion | Status |
|---|---|---|
| A1 | Every deliverable present | ✅ 34/35 here; deliverable 18 (Implementation Roadmap) is the separate Blueprint by design |
| A2 | No contradiction between sections | ✅ seven found in inputs, all resolved in §0 |
| A3 | Every entity appears once, named consistently | ✅ C1 resolved — `Statement` throughout |
| A4 | Every load-bearing claim argued, not asserted | ✅ acyclicity, identity, context, trust, split |
| A5 | Every guess marked and given a resolution trigger | ✅ §34 |
| A6 | Every principle enforced by a named test | ✅ §29 |
| A7 | No domain-specific assumption in a core table | ✅ verified against nine domains |
| A8 | Every schema field justified | ✅ §10 + absent-list |
| A9 | Rollback exists for every phase | ✅ §21.1 |
| A10 | Falsifiable | ✅ §33.1 |
| A11 | Implementable without further architectural questions | ✅ blueprint |

## 35.1 Known limitations, stated honestly

1. **Teaching asset sourcing is unsolved at scale.** Pedagogy lives in teachers and research, not textbooks. The architecture holds it; where it comes from beyond the first three kinds is D6.
2. **Community review has never run.** Reputation weighting is designed against zero reviewers.
3. **Split has never been executed.** Designed carefully; the first real one will teach us something.
4. **10,000 person-years remains 10,000 person-years.** The ladder and the self-defending graph reduce the constant, not the order.

Stating these is the point of A5. An architecture that claims no limitations is concealing them.

## 35.2 Freeze

On approval this document is **frozen**. Changes require a written amendment recording: what changed, which section, which failure prompted it, and which test now guards it.

Everything after this is implementation.

---

*End of the Final Architecture Baseline.*
