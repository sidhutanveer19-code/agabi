# Universal Knowledge Factory — Review Report

Audit of the Content Engineering + Knowledge Population infrastructure against the frozen
architecture and the factory vision. Verified against the repo, not prior conversations.

## 1. Architecture score — **9/10**
Sound and extension-ready. Engine ⟂ content boundary holds; curriculum is data (profiles + packages);
walls W1–W7 green (12/12); the orchestration layer's placement is justified (ADR-12). One real defect
was found and fixed (idempotency, §4). −1 for the deferred HTML heading-level + PDF-parser slot (both
declared, not hidden).

## 2. Duplication report — **none**
Single ingest orchestrator (`content/orchestrator.ts`); single store; single trust ladder; single
review queue; single discovery; one connector registry; one parser registry; one dataset loader. No
parallel pipelines, no shadow implementations (grep-verified). The population "workers" of the vision
are **the orchestrator's stages** — building a separate worker subsystem was rejected as duplication.

## 3. Missing-capability report
| Capability | State | Note |
|---|---|---|
| Ingestion engine / discovery / coverage / quality / connectors / dataset / lifecycle / golden / detectors | **DONE** | W1–W8, committed, tested |
| Idempotent / resumable re-ingest | **DONE (fixed this pass)** | was a real bug; now content-key skip |
| Source priority ranking | **DONE (this pass)** | `sourcePriority.ts`, orders population |
| Population "workers", incremental population | **SATISFIED by reuse** | orchestrator stages + `loadDataset` per source + idempotency (re-run = resume) |
| 30+ teaching-object KINDS (explanation, intuition, analogy, misconception, …) | **DEFERRED by design** | seam open (teaching/registry capability dispatch, §18C.1); populating them is human-gated content (IR1), NOT an engine gap. Adding a kind = a registry entry, no schema change |
| New graphs (misconception/transfer/similarity/…) | **DEFERRED by design** | each is a new `*Edge` table + DAG test (ADR-1); a seam, not built prematurely |
| Bulk curriculum population | **DEFERRED by design** | human-gated after every engine box is green (IR1, §15.2); needs licensed content |

## 4. Technical-debt report
- **Fixed:** re-ingest idempotency (statements/edges/assets/items now skip duplicates).
- **Known, documented:** HTML discovery is flat (`parseHtml` drops heading level); PDF is a throwing
  slot (E8/G6 — a parser dep is stop-and-ask); non-SPO statement dedup is not content-keyed (SPO is).
- **No hidden debt:** no dead code paths, no magic-constant sprawl, no silent truncation.

## 5. CLAUDE.md compliance — **pass**
Repo-as-truth (audited files, not memory); decide-don't-ask (took frozen defaults); scope discipline
(reused before building; rejected a duplicate worker subsystem); verification mandatory (every
milestone tsc/lint/vitest/build green); honesty protocol (surfaced the false "idempotent" claim and
fixed it rather than hiding it). No frozen module rewritten; no new npm dep; no `db push` performed by
the agent.

## 6. Documentation report — **current**
`docs/phase-2/`: ARCHITECTURE · PIPELINE · CONNECTORS · CONTENT-IMPORT-SPEC · LIFECYCLE ·
EXTENSION-GUIDE · COMPLETION-REPORT · this review. Updated in the same milestone as the code. ADR-12
recorded.

## 7. Completed work
Content Engineering Infrastructure (W1–W9) + idempotency fix + source priority. 298 tests pass / 1
gated-skip; build ✓; walls green.

## 8. Remaining work (all data / human-gated, not engineering)
Author a real golden + one licensed markdown chapter (measure live `qwen2.5` extraction) · CI gate for
the live DB/Ollama paths · PDF-parser dependency (stop-and-ask) · HTML heading-level enhancement ·
populate the 30+ teaching-object kinds (content, human-gated) · Phase-2.1 authoring UIs · launch gates
§27.1 copyright / §27.2 DPDP minors.

## 9. Risks
🟡 Live-model extraction quality unmeasured (fake invoker in tests) · 🟡 no CI for live paths · 🟢 HTML
flat · 🟢 PDF deferred · 🟢 duplicate assets/items across runs are content-keyed but not
provenance-merged (review-visible, ADR-10 anyway).

## 10. Recommendations for Phase 3
1. Author one golden + one licensed chapter; run live; read the quality number (the M3/M7 gate input).
2. Add a CI job running `RUN_DB_CONFORMANCE=1` + a live pipeline smoke.
3. Build the Phase-2.1 authoring UIs on the workspace + detectors.
4. When a teaching-object kind is needed, add it as a `teaching/registry` kind (capability dispatch).

## 11. Backend Phase 2 completion
- **Infrastructure / factory: ~100%** (every engine box green + verified).
- **Populated knowledge graph: 0% by design** (human-gated content — IR1; must not start before the
  engine is complete, which it now is).

## 12. Is Backend Phase 2 (Knowledge + Content Infrastructure) truly complete? **YES — the ENGINE.**
Evidence: all engineering DoD boxes green (ingestion, discovery, dataset spec, connectors, coverage,
quality, golden, lifecycle, detectors, source-priority, docs, extension guide, completion report,
architecture tests 12/12); 298 tests pass / 1 gated-skip; tsc 0; lint 0 err; build ✓; a real
idempotency defect was found and fixed. **NO** for a *populated* graph — that is the separate,
human-gated content phase that this infrastructure exists to serve, and it correctly has not begun.
