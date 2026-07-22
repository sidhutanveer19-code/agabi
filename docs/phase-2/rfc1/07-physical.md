# Part VII — Physical: Storage, Indexing, Scale

---

# 30. Storage

## 30.1 The graph is a logical model, not a database model 🔒

Nothing in Parts III–VI mentions a database engine. `Concept`, `Statement`, `Edge`, and `Context` are defined by their semantics and their access patterns. The physical store is an implementation detail behind `KnowledgeStore` (§10.2).

This is stated first because it is the actual answer to the vendor-lock-in requirement. Lock-in is not avoided by choosing an unusual database; it is avoided by ensuring the domain model never depends on one.

## 30.2 Requirements, derived from §33.1

| # | Requirement | Source |
|---|---|---|
| S1 | Point lookup by id, < 5 ms | A1, A3 |
| S2 | Bounded recursive traversal, depth ≤ 6, < 50 ms | A2, A6 |
| S3 | Lexical + fuzzy text matching | A1 rung 3 |
| S4 | Multi-column filtering with ranking (context specificity) | A3 |
| S5 | **Transactional multi-row writes** — a review batch commits atomically or not at all | §24 |
| S6 | Point-in-time reads via version filtering | §27.4 |
| S7 | Append-only with no destructive operations | §2.5 |
| S8 | Offline analytics — self-joins over the full table | A8, A9, A11 |
| S9 | Vector similarity | A1 rung 4, deferred |

**S5 is the discriminator most comparisons miss.** Review is the only write path, and a batch decision must be atomic — approving 12 statements, creating 3 edges, and writing 15 review events either all happen or none do. A store without real transactions turns a partial failure into silent graph corruption, and the corruption is undetectable because there is no consistent state to compare against.

## 30.3 Candidate evaluation

### PostgreSQL

| Req | Assessment |
|---|---|
| S1 | ✅ B-tree, sub-millisecond |
| S2 | ✅ recursive CTE; shallow bounded traversal is well within its envelope |
| S3 | ✅ `pg_trgm` + GIN |
| S4 | ✅ its core competence |
| S5 | ✅ **full ACID** |
| S6 | ✅ ordinary predicates |
| S7 | ✅ enforced in application code |
| S8 | ✅ SQL |
| S9 | ✅ pgvector, when needed |

Weakness: deep or unbounded traversal degrades. **Not a workload here** (§33.1). Recursive CTEs materialise intermediate results, so a 20-hop query over millions of nodes would be poor — but prerequisite chains are single-digit by cognitive necessity, and `maxDepth` is mandatory (§34.1).

Already deployed, already backed up, already understood. Cost of adoption: zero.

### Neo4j / Memgraph

| Req | Assessment |
|---|---|
| S1 | ✅ |
| S2 | ✅✅ purpose-built; index-free adjacency |
| S3 | ⚠️ full-text via Lucene plugin; weaker than `pg_trgm` for fuzzy matching |
| S4 | ⚠️ Cypher is awkward for multi-dimensional specificity ranking |
| S5 | ✅ Neo4j has ACID |
| S6 | ⚠️ no native temporal; same manual version filtering |
| S8 | ⚠️ analytical self-joins are not its strength |
| S9 | ⚠️ plugin |

**Rejected for v1.** The traversal advantage is real but applies to a workload we do not have. Against it: a second database to operate, back up, secure, monitor and pay for; Neo4j's AGPL/commercial licensing is precisely the vendor-lock-in risk to avoid; and the *majority* of our access patterns (S3, S4, S8) are relational, not graph-shaped. Optimising the minority case at the cost of the majority is the wrong trade.

Revisit if measurement shows traversal is the bottleneck. It will not be, because §31.2 removes traversal from the hot path entirely.

### Document store (MongoDB, DynamoDB)

| Req | Assessment |
|---|---|
| S1 | ✅ |
| S2 | ❌ no recursive traversal; requires N round-trips per level |
| S4 | ⚠️ |
| S5 | ⚠️ limited multi-document transactions |
| S8 | ❌ |

**Rejected.** The model is highly relational — statements reference concepts, edges reference concepts, mappings reference both. Denormalising into documents would require embedding concepts inside statements, which duplicates the entity and destroys the single-identity property (§14) that the whole design exists to protect.

### Search index (Elasticsearch / OpenSearch)

**Rejected as canonical store; adopted later as a derived index.** No transactions, eventual consistency, and no referential integrity. Excellent at S3 and it will likely become the search implementation at scale — but a search index is a *projection*, never a source of truth. Losing it must be a re-index, not a data loss.

### Triple store (Jena, Blazegraph)

**Rejected.** §12.3 — context is second-class, payloads are not triples, ops burden, no interoperability requirement today.

## 30.4 Decision 🔒

**ADR-10 — PostgreSQL as canonical store; derived indexes added on measurement**

*Decision.* Postgres holds the canonical graph. All access is through `KnowledgeStore`. Derived stores — a search index, a traversal cache, a vector index — may be added later as **projections rebuildable from canonical data**.

*Rationale.*
1. The workload is majority-relational; the graph-shaped minority is shallow and bounded.
2. S5 (atomic review batches) is non-negotiable and Postgres does it natively.
3. It is already running. Zero new infrastructure, zero new failure modes, zero new cost, for a product with no users.
4. `KnowledgeStore` means the decision is reversible at the cost of one file.

*Alternatives.* Evaluated above.

*Consequences.* At 100M concepts this needs partitioning and read replicas (§42) — a data-volume problem with known solutions that changes no semantics. It does not need a different engine, and if it ever does, the interface makes that a contained change.

*Falsification.* If p95 on A2 exceeds 50 ms with caching in place, this ADR is wrong and a traversal engine should be introduced behind the same interface.

## 30.5 The target architecture at scale

```
                    ┌──────────────────────────────┐
   writes ─────────▶│  PostgreSQL — CANONICAL      │
   (review only)    │  ACID · versioned · truth    │
                    └────────┬─────────────────────┘
                             │  change stream / rebuild
             ┌───────────────┼───────────────┬────────────────┐
             ▼               ▼               ▼                ▼
      ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
      │ closure    │  │ search     │  │ vector     │  │ analytics  │
      │ cache      │  │ index      │  │ index      │  │ replica    │
      │ (Redis)    │  │ (OpenSrch) │  │ (pgvector) │  │            │
      └────────────┘  └────────────┘  └────────────┘  └────────────┘
        A2 hot path     A1 rung 3-4     A1 rung 4       A8 A9 A11

   ALL derived. ALL rebuildable. NONE is a source of truth.
   Losing any of them is a rebuild, never a data loss.
```

**None of the derived stores exist in Phase 2A.** They are introduced when measurement demands them, in the order the measurements dictate.

---

# 31. Indexing

## 31.1 Index inventory

| Table | Index | Serves |
|---|---|---|
| Concept | `(status, kind)` | teachable filter |
| Concept | `(slug)` unique | rung 1 |
| Concept | `(scope, status)` | tenant isolation |
| ConceptAlias | `(alias)` | rung 2 |
| ConceptAlias | GIN trigram on `alias` | rung 3 |
| ConceptTag | `(namespace, value)` | tag search |
| Statement | `(subjectId, confidence)` | statements for a concept |
| Statement | `(contextId)` | context filtering |
| Statement | `(predicate, objectId)` | contradiction detection |
| Statement | GIN trigram on `text` | rung 3 |
| Edge | `(fromId, type, version)` PK | forward traversal |
| Edge | `(toId, type)` | **reverse traversal — review ordering** |
| Mapping | `(conceptId)` | "which programs teach this?" |
| ProgramNode | `(programId, parentId, ordinal)` | subtree browse |
| Provenance | `(sourceId)` | source deprecation cascade |
| ReviewEvent | `(targetKind, targetId)`, `(batchId)` | audit |
| ReleaseMember | `(releaseId, kind, entityId)` PK | point-in-time |

## 31.2 Removing traversal from the hot path ⚖️

The prerequisite closure for a concept changes only when an edge in its subgraph changes — which happens only on review, which is rare.

```prisma
model ClosureCache {
  conceptId String
  edgeType  String
  releaseId String
  closure   Json        // ordered ConceptId[] with depths
  computedAt DateTime
  @@id([conceptId, edgeType, releaseId])
}
```

**v1 invalidation: clear the entire cache on any review batch commit.** Crude, correct, and cheap at current volumes. Subgraph-precise invalidation is 🔬 provisional and should wait until real edge-write patterns are observed — premature precision here risks a subtle staleness bug that is very hard to detect.

With this cache, A2 becomes a point lookup and the "Postgres can't traverse" objection (§4.6) is moot for the hot path.

## 31.3 Partial indexes

Most queries only ever touch `VERIFIED` rows. Partial indexes keep them small:

```sql
CREATE INDEX concept_teachable ON "Concept" (kind)
  WHERE status = 'VERIFIED' AND scope = 'PUBLIC';
CREATE INDEX statement_current ON "Statement" ("subjectId", "contextId")
  WHERE confidence = 'VERIFIED';
```

At a 20:1 ratio of historical-to-current rows — plausible after years of versioning — this keeps the hot indexes an order of magnitude smaller than the tables.

---

# 42. Scaling to 100M+ Concepts

## 42.1 Honest staging

| Stage | Concepts | Statements | Edges | Architecture |
|---|---|---|---|---|
| **Phase 2A** | 10² | 10³ | 10³ | single Postgres, no cache |
| **Class 10 complete** | 10⁴ | 10⁵ | 10⁵ | + closure cache |
| **Multi-board, K-12** | 10⁵ | 10⁶ | 10⁶ | + read replica, partial indexes |
| **+ professional domains** | 10⁶ | 10⁷ | 10⁷ | + search index |
| **Global, all domains** | 10⁸ | 10⁹ | 10⁹ | + partitioning, + traversal engine if measured |

At 10⁸ concepts with 10 statements each, `Statement` holds 10⁹ rows at roughly 1 KB — about 1 TB. Large, entirely ordinary for Postgres with partitioning. This is not a scale that requires an exotic engine; it requires competent operations.

## 42.2 What changes and what does not

**Never changes:** the logical model, `KnowledgeStore`, the review workflow, versioning semantics, provenance, context matching, and every consumer.

**Changes at scale:**

| Stage | Change | Trigger |
|---|---|---|
| 10⁴ | closure cache | A2 p95 > 30 ms |
| 10⁵ | read replica for search + analytics | write contention |
| 10⁶ | dedicated search index | rung-3 p95 > 100 ms |
| 10⁷ | partition `Statement` by scope, then by hash of `subjectId` | table > 500 GB |
| 10⁷ | partition `Edge` similarly | index no longer fits memory |
| 10⁸ | traversal engine as a derived store | A2 p95 > 50 ms *with* cache |

Every one is additive. None requires re-authoring content or migrating semantics — which is the actual meaning of "no architectural redesign".

## 42.3 The real scaling constraint is not technical

100M concepts requires 100M verifications. At the review rates in §36, one person produces ~10⁴/year. 100M concepts is **10,000 person-years** of verification.

Therefore reaching 10⁸ is a *contribution* problem, not a storage problem: thousands of contributors, federated review, trust and reputation weighting, and probably accepting bulk-imported knowledge at lower confidence tiers than human-verified knowledge.

The architecture supports this — `ReviewEvent.actorId`, `Statement.confidence`, `Statement.authority`, and `scope` are exactly the primitives a multi-contributor trust system needs. But the *workflow* for it is out of scope here, and pretending otherwise would be designing against imagination.

**The storage architecture is ready for 100M concepts long before the organisation is.**

---

*End of Part VII. Part VIII — Content Operations (§35–37) follows.*
