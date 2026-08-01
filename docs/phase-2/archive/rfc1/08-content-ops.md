# Part VIII — Content Operations

---

# 35. Knowledge Ingestion Pipeline

## 35.1 Stage contract

Every stage is `(input, config) → output` with no hidden state. Stages 2–5 are pure: identical bytes produce identical output on any machine at any time.

```
┌────────┐  ┌───────┐  ┌───────┐  ┌───────────┐  ┌───────┐
│ fetch  │─▶│ parse │─▶│ clean │─▶│ normalise │─▶│ chunk │
└────────┘  └───────┘  └───────┘  └───────────┘  └───┬───┘
   I/O        pure        pure         pure          │ pure
                                                     ▼
                                          ┌──────────────────┐
                                          │ extract  ADVISOR │  ← only model
                                          └────────┬─────────┘
                                                   ▼
┌──────────┐  ┌────────┐  ┌───────┐  ┌───────────────────┐
│ validate │─▶│ dedupe │─▶│ stage │─▶│ HUMAN REVIEW      │
└──────────┘  └────────┘  └───────┘  └───────────────────┘
    pure         pure      write         the only door
```

## 35.2 Span-preserving cleaning 🔒

Cleaning must not destroy locators (§11.3). Text is carried as spans, not strings:

```ts
interface Span { text: string; sourceRange: [number, number]; page: number; }
type Doc = Span[];
```

Removing a running header drops a `Span` and leaves the others' `sourceRange` intact. A quote's character range therefore maps back to the original page even after several transformations — which is what lets the review UI highlight it in the real passage (§36.2).

Doing this with plain strings loses the mapping irrecoverably, and it cannot be reconstructed afterwards.

## 35.3 Chunking ⚖️

Boundaries at section headings, with a target of 800–1,500 tokens and 100 tokens of overlap. Never split mid-sentence.

```
chunkId = sha256(sourceId + JSON(locator) + normalisedText)
```

Content-addressed: a chapter re-ingested unchanged produces byte-identical ids, so no extraction re-runs. A chapter with one edited paragraph produces one new id and everything else is a cache hit.

🔬 Chunk size is a guess. Too small loses the context needed to identify prerequisites; too large dilutes extraction quality. Measure against the golden set (§44.5) and tune.

## 35.4 Extraction 🔬

```ts
interface RawProposal {
  kind: string;
  quote: string;                  // VERBATIM. mandatory. auto-reject if absent.
  conceptNames: string[];         // by NAME. resolution is deterministic, not model-chosen.
  subject: string; predicate: string; object?: string; objectLiteral?: string;
  text: string;                   // WRITTEN, not copied (V7)
  payload: unknown;               // validated by the kind's registry schema
  context?: Partial<Context>;
  prerequisiteNames?: string[];
  locator: Locator;
}
```

Returned as `Advice<RawProposal[]>`. Unusable until `accept()`.

The extractor never sees an id, never writes, and cannot express `VERIFIED` — the type it returns has no such field.

## 35.5 Deduplication ⚖️

Three tiers, cheapest first:

| Tier | Method | Action |
|---|---|---|
| 1 | exact name/slug match | resolve to existing — not a duplicate, a reference |
| 2 | alias match | resolve to existing |
| 3 | trigram similarity ≥ 0.85 | **merge decision queued for a human** |
| — | below 0.85 | propose as new |

The 0.85 threshold is 🔬 provisional. Tune from observed false-merge and missed-merge rates — both are measurable from `ReviewEvent` outcomes.

**Never auto-merge.** A wrong merge is far more damaging than a duplicate: a duplicate is visible and fixable, whereas a wrong merge silently conflates two distinct ideas and every downstream mastery record inherits the error.

## 35.6 Failure handling

| Failure | Response |
|---|---|
| parse fails | source marked `INGEST_FAILED`, logged, no partial data |
| extractor returns invalid JSON | `accept()` returns null, batch discarded, counted |
| extractor unavailable | chunk queued, retried with backoff |
| **>50% of a batch fails validation** | **halt the source**, alert — signals a bad prompt or a mis-parsed document |
| duplicate storm (>30% tier-3) | halt, alert — signals the source is already ingested |

The two halt conditions exist because the expensive failure mode is not a rejected proposal; it is thousands of subtly bad proposals consuming human review time.

---

# 36. Human Review Workflow

*The bottleneck (§3.7). Everything here optimises reviewer throughput.*

## 36.1 Throughput arithmetic

| Approach | Rate | Class 10 (10⁴ statements) |
|---|---|---|
| Individual cards, no source | ~60/hr | 167 hours |
| **Batched, source in view, quote highlighted** | ~200/hr | **50 hours** |
| Batched + auto-reject filtering | ~250/hr | 40 hours |
| Batched + leverage ordering (usable at 40% coverage) | effective 2× | **~20 hours to useful** |

The design target is the third and fourth rows. The difference between row 1 and row 4 is the difference between a project that finishes and one that does not.

## 36.2 The batch screen

```
┌──────────────────────────────┬──────────────────────────────────┐
│ SOURCE  NCERT Sci X · Ch6    │ PROPOSALS (8)                    │
│ p.98 §6.2                    │                                  │
│                              │ ☑ 1  FACT                        │
│ Green plants use sunlight    │   Photosynthesis → converts →    │
│ to prepare food. ▓▓▓▓▓▓▓▓▓▓  │   Light energy                   │
│ ▓This process is called      │   "Photosynthesis converts light │
│ ▓photosynthesis.▓ During     │    energy into chemical energy." │
│ this, ▓chlorophyll absorbs   │   ✓ grounded  ✓ new  ⚑ prereq:   │
│ light energy▓ and…           │     Chlorophyll (exists)         │
│                              │                                  │
│ [highlights track the        │ ☑ 2  FACT  Chlorophyll →         │
│  selected proposal]          │   absorbs → Light energy         │
│                              │ …                                │
├──────────────────────────────┴──────────────────────────────────┤
│  [A] approve all   [X] reject selected   [E] edit   [M] merge   │
└─────────────────────────────────────────────────────────────────┘
```

Three properties make it fast:

1. **The passage is read once for eight decisions.** Reviewing a list of decontextualised cards means re-establishing context eight times.
2. **The quote is highlighted in place** — possible only because of span-preserving cleaning (§35.2) and the `charRange` returned by grounding validation (§23.2). The reviewer verifies by *comparison*, not by recall.
3. **Approve-all is one keystroke.** Extraction is mostly right; the interface should optimise for the common case and make exceptions cheap.

## 36.3 Queue ordering ⚖️

```
priority = w₁·dependentCount        // leverage: an error here propagates
         + w₂·knowledgeMissCount    // real student demand (§4.1)
         + w₃·programWeight         // exam importance
         − w₄·ageInQueue            // starvation guard
```

`knowledgeMissCount` is the important term. It comes from the evidence log — topics students actually requested and the graph could not serve. Review effort follows observed demand rather than curriculum order, which is what makes the first 200 concepts disproportionately valuable.

## 36.4 What is never asked of a reviewer

| Not asked | Why |
|---|---|
| assign difficulty | does not exist (§14.4) |
| assign an id | machine-minted (§29) |
| write from scratch | they edit a proposal |
| check quote presence | machine-verified (§23.2) |
| check payload shape | machine-verified |
| find duplicates | machine-surfaced |
| judge more than ~8 items per screen | throughput and fatigue |

Human attention is spent exclusively on judgment: *is this true, is it well-stated, is it the right shape, is it original wording.*

## 36.5 Reviewer trust ⚖️

`ReviewEvent.actorId` plus per-reviewer accuracy (measured by later disputes on their approvals) is the substrate for multi-contributor scaling. Not implemented in Phase 2 — there is one reviewer — but the data is captured from the first review, because reconstructing it later is impossible.

---

# 37. Research Connectors

## 37.1 One interface

```ts
export interface SourceConnector {
  id: string;
  kinds: SourceKind[];
  fetch(ref: string): Promise<{ source: RawSource; bytes: Buffer }>;
  license(ref: string): Promise<LicenseInfo>;   // called BEFORE fetch
  rateLimit?: RateLimitPolicy;
}
```

`license()` is called first and can **refuse ingestion** (§41). A connector that cannot determine a licence must return `UNKNOWN`, and unknown-licence sources require explicit human approval before ingestion proceeds.

## 37.2 Planned connectors

| Connector | Kind | Licence posture | Phase |
|---|---|---|---|
| local filesystem (PDF/MD/HTML) | manual | operator asserts | 2A |
| NCERT PDFs | book | ⚠️ free download ≠ free reproduction (§41) | 2A |
| Government curriculum documents | dataset | usually permissive | 2D |
| Wikipedia / Wikidata | web | CC-BY-SA — **attribution obligations** | later |
| OpenStax | book | CC-BY | later |
| arXiv / PubMed | paper | mixed; abstracts generally usable | later |
| Web crawler | web | ⚠️ requires per-domain assessment | later |

## 37.3 The invariant 🔒

> **Research never writes to the graph.** Every connector produces `PROPOSED` knowledge and enters the identical pipeline. There is no privileged path, no trusted source, no auto-approval for authoritative publishers.

A connector is a registry entry. Adding one changes no architecture, and — critically — cannot weaken the review guarantee, because the only door into `VERIFIED` is `applyReview` with a human actor (§24.2).

---

*End of Part VIII. Part IX — Assurance (§39–41, 43–45) follows.*
