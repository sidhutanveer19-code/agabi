# Part VI — Identity, Time and Truth

---

# 29. IDs 🔒

*The most irreversible decision in the platform. Placed first in this part because §27 and §28 depend on it.*

## 29.1 The rule

**ADR-8 — Identity is opaque, immutable, and meaningless**

*Context.* The natural instinct is readable identifiers: `BIO.PHOTO.CHLORENERGY`. They are pleasant in review screens, in URLs, and in debugging.

*Decision.* Identity is a `cuid2` — opaque, collision-resistant, meaningless. Human readability is a **separate, mutable `slug`** which **no foreign key ever references**. Classification lives in tags (§14.3).

*Rationale — three independent failure modes, each certain over a decade:*

1. **Reclassification.** `BIO.` asserts Biology. Chlorophyll absorbing light is also Physics. The prefix becomes false and cannot be corrected without rewriting every reference.
2. **Reorganisation.** `PHOTO.` asserts a position under photosynthesis. The 2028 NCERT edition reorganises. The id now describes a structure that no longer exists.
3. **Multilingual and multi-curricular expansion.** A Hindi-medium slug and a CBSE slug for the same concept cannot both be the identity.

*Alternatives.*
(a) Readable hierarchical ids — rejected, above.
(b) UUIDv4 — acceptable, but not k-sortable, so index locality is poorer and debugging ordering is harder.
(c) Natural key on `name` — rejected: names change, and two concepts may share a name across domains.
(d) **cuid2** — chosen: opaque, k-sortable, URL-safe, collision-resistant, no dependency beyond what is already used for `Lesson.id`.

*Consequences.* Debugging requires a slug lookup. Mitigated by returning slugs in every API response and by the review UI displaying them. This is a small, permanent cost that buys a permanent guarantee.

## 29.2 Slugs

```ts
slugify("Chlorophyll absorbs light energy") → "chlorophyll-absorbs-light-energy"
```

- Unique, but **mutable**.
- On change, the old slug is retained in `ConceptAlias` with `kind: FORMER_NAME`, so old links keep resolving.
- **Never** an FK target. Enforced by test: no Prisma relation references `slug`.

## 29.3 Resolution follows tombstones

```ts
async function resolveSlug(slug: string): Promise<ConceptId | null> {
  // 1. current slug  2. former-name alias  3. follow mergedInto chain (bounded)
}
```

A merged concept's id resolves forever to its target. **No reference ever breaks** — which is what makes merging (§4.3's countermeasure) psychologically safe enough that reviewers will actually do it.

## 29.4 ID scheme by entity

| Entity | Scheme | Rationale |
|---|---|---|
| Concept, Statement, Edge, Item | cuid2 | opaque identity |
| Context | **hash of the tuple** | identical contexts must share a row |
| SourceChunk | `sha256(sourceId + locator + normalisedText)` | content-addressed → deterministic re-ingestion |
| Source | `sha256(checksum)` | same bytes = same source |
| Release | `YYYY-MM-DD-nn` | human-meaningful, and releases are immutable by nature |

Two deliberate exceptions to opacity: `Context` and `SourceChunk` ids are **derived from content**, because their identity *is* their content. A context with the same dimensions is the same context; a chunk with the same bytes at the same locator is the same chunk. This is the property that makes §11.6 re-ingestion a diff.

---

# 27. Versioning Architecture 🔒

## 27.1 Nothing is overwritten

**ADR-9 — Correction creates a version; it never mutates**

Every mutable knowledge entity carries `version` and `supersedes`. Editing creates a new row; the old is marked `DEPRECATED` and remains readable forever.

*Rationale.* G6 requires any past lesson to be reconstructable. If a statement is mutated in place, a 2026 lesson replayed in 2029 shows 2029's text — silently rewriting history and making the evidence log a liar.

*Alternatives.* (a) Mutate + audit log — rejected: reconstructing old state means replaying the audit log backwards, which is fragile and slow. (b) Temporal tables — rejected: Postgres-specific, violating §30's engine independence. (c) **Explicit version chains** — chosen: portable, queryable, obvious.

*Consequences.* Row count grows with edits. Acceptable — edits are rare relative to reads, and storage is cheap. Queries must filter to current versions by default; the store interface does this unless `at` is supplied.

## 27.2 What is versioned

| Entity | Versioned | Note |
|---|:-:|---|
| Concept | yes | rare — identity is stable by design |
| Statement | **yes** | the common case; beliefs change |
| Edge | yes | prerequisites are revised |
| AssessmentItem | yes | |
| ConceptTag | **no** | classification is data; history in `ReviewEvent` |
| ConceptAlias | **no** | additive; removal is rare and logged |
| Mapping | yes | syllabi change between editions |
| Context | **no** | immutable by construction (id is its hash) |

## 27.3 Version chains

```
Statement s_a1  v1  "Chlorophyll absorbs light."           DEPRECATED  supersedes: null
Statement s_b2  v2  "Chlorophyll absorbs light energy in   VERIFIED    supersedes: s_a1
                     the 400–500 nm and 660–700 nm bands."
```

`getCurrent(conceptId)` filters to statements with no successor. `getVersionChain(id)` walks `supersedes` backwards. Both are single indexed queries.

## 27.4 Graph releases 🔒

```prisma
model Release {
  id        String   @id      // "2026-08-01-01"
  label     String
  createdAt DateTime @default(now())
  frozen    Boolean  @default(false)
}
model ReleaseMember {
  releaseId String
  kind      String            // CONCEPT | STATEMENT | EDGE | ITEM | MAPPING
  entityId  String            // the specific VERSION
  @@id([releaseId, kind, entityId])
}
```

A release **pins exact version ids**. A lesson records the release it taught against.

This is the mechanism behind G6: replaying a 2026 lesson means querying with `at: "2026-08-01-01"`, which resolves every concept and statement to the exact version in force. Not "the current text of the concept the student saw" — the actual text.

Releases are created on a schedule and before any significant content change. They are cheap: a set of ids.

## 27.5 Merges and tombstones

```
Concept c_dup  "Chlorophyll pigment"   status: MERGED   mergedInto: c_main
```

Merging:
1. Move aliases, tags, statements, edges, and mappings from loser to winner.
2. Statements that would now duplicate are marked as alternate wordings, not deleted.
3. Loser becomes `MERGED` with `mergedInto` set.
4. A `ReviewEvent` with `decision: MERGE` records the full before-state.

The loser row is **never deleted**, so historical lessons and mastery records referencing it still resolve (§29.3).

---

# 28. Provenance 🔒

## 28.1 The rule

> Every `VERIFIED` statement MUST have at least one provenance row whose quote is literally present in its source chunk.

Enforced as a **standing test over the whole graph** (§44), not merely at write time. A statement that loses its provenance — through a bad migration, a deleted source, or a bug — is detected on the next CI run.

## 28.2 Why it cannot be backfilled

If a statement is created without provenance, the information required to add it later does not exist anywhere. Nobody remembers which page it came from. The statement is permanently unverifiable and can only be re-derived from scratch — which is indistinguishable from re-authoring the entire graph.

This is why provenance is load-bearing and why V3 (§23.2) rejects rather than warns.

## 28.3 What provenance records

| Field | Answers |
|---|---|
| `sourceId`, `chunkId`, `locator` | where it came from |
| `quote` | the exact supporting text |
| `extractorVersion`, `promptVersion`, `modelId` | which machinery proposed it |
| `extractedAt` | when |
| the linked `ReviewEvent` | who verified it, when, and on what basis |

Together these answer *"why does Agabi believe this?"* completely — machine and human, both recorded.

## 28.4 Provenance for non-extracted knowledge

Hand-authored concepts still require provenance. `Source` supports `kind: MANUAL` with the author as authority. The rule has no exception: knowledge without a stated basis is not verifiable, whoever wrote it.

---

# 38. Knowledge Evolution

## 38.1 The five ways knowledge changes

| Change | Mechanism | History |
|---|---|---|
| **Correction** — it was wrong | new version, old `DEPRECATED` | full |
| **Refinement** — it was imprecise | new version | full |
| **Supersession** — reality moved | new statement, old gets `validUntil` | both current |
| **Retraction** — affirmatively false | `RETRACTED`, no replacement | retained, marked |
| **Reclassification** — organised wrongly | tag update | `ReviewEvent` |

Note that **supersession is not correction**. The 2018 hypertension guideline was not wrong in 2018. Marking it `DEPRECATED` would falsify history; giving it a `validUntil` records the truth — it was correct, and then time passed.

## 38.2 Cascading review

When a statement changes, things that depended on it may now be wrong:

```
statement changes
  → assessment items evidencing its concept    → flagged for re-review
  → statements citing it via SUPPORTS          → flagged
  → curriculum mappings at MASTER depth        → flagged
  → lessons already taught                     → NOT changed (history is immutable)
```

Flagged means queued, not auto-modified. A human decides. The last line is the important one: a lesson taught last year is a historical fact and is never retroactively edited.

## 38.3 Deprecating a source

A source may be withdrawn — a retracted paper, a superseded edition, a licence revocation. Statements sourced *only* from it move to `DISPUTED` and become non-teachable pending re-sourcing. Statements with independent corroborating provenance are unaffected — which is the concrete payoff of allowing multiple provenance rows per statement (§22.2).

---

*End of Part VI. Part VII — Physical (§30–31, 42) follows.*
