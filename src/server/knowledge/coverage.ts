import type { KnowledgeStore } from "@/server/knowledge/store/KnowledgeStore";
import type { ReadScope, TrustPolicy } from "@/server/knowledge/types";

/**
 * Coverage (W3, gap 2.7). A **derived, never-stored** report (ADR-11): a pure query over the
 * store that rebuilds byte-identical from the same state. It answers "how much of what we
 * ingested actually became justified knowledge?" — the number the M3/M7 gates and the
 * missing-concept detector consume.
 *
 * Two axes:
 *  · concept coverage — a concept is COVERED if it is the subject of ≥1 statement; the rest are
 *    orphans (a name was extracted but nothing was asserted about it).
 *  · grounding — a statement is GROUNDED if it carries ≥1 provenance row (a source it traces to).
 *
 * Deterministic: id lists are sorted, so two runs over the same store are identical.
 */
export interface CoverageReport {
  concepts: number;
  coveredConcepts: number;
  orphanConcepts: string[]; // concept ids with no subject-statement (sorted)
  statements: number;
  groundedStatements: number;
  ungroundedStatements: string[]; // statement ids with no provenance (sorted)
  /**
   * ORPHAN RATE, not curriculum breadth. Read the name literally: it is the share of concepts we
   * already have that carry an assertion. It says nothing about how much of a syllabus was
   * ingested, and is satisfiable at 100% by a pipeline that ingested one paragraph. Use
   * `corpusCoverage` for breadth; keep both, and never quote this one as "coverage".
   */
  coverageRate: number; // coveredConcepts / concepts
  groundingRate: number; // groundedStatements / statements
}

export async function coverageReport(store: KnowledgeStore, scope: ReadScope, policy: TrustPolicy): Promise<CoverageReport> {
  const concepts = await store.listConcepts(scope);
  const orphanConcepts: string[] = [];
  const statementIds = new Set<string>();
  let coveredConcepts = 0;

  for (const c of concepts) {
    const stmts = await store.statementsForSubject(c.id, scope, policy);
    if (stmts.length === 0) orphanConcepts.push(c.id);
    else {
      coveredConcepts++;
      for (const s of stmts) statementIds.add(s.id);
    }
  }

  const ids = [...statementIds].sort();
  const ungroundedStatements: string[] = [];
  let groundedStatements = 0;
  for (const id of ids) {
    const prov = await store.provenanceFor(id);
    if (prov.length === 0) ungroundedStatements.push(id);
    else groundedStatements++;
  }

  const rate = (num: number, den: number) => (den === 0 ? 0 : num / den);
  return {
    concepts: concepts.length,
    coveredConcepts,
    orphanConcepts: orphanConcepts.sort(),
    statements: ids.length,
    groundedStatements,
    ungroundedStatements,
    coverageRate: rate(coveredConcepts, concepts.length),
    groundingRate: rate(groundedStatements, ids.length),
  };
}

/**
 * CORPUS COVERAGE — the breadth metric `coverageRate` is not.
 *
 * The question a curriculum owner actually asks is "how much of the syllabus is in there?", and the
 * orphan-rate above cannot answer it: ingest 5% of a book with no orphans and it reports 100%. This
 * measures the ingested text instead, at two levels, both computable from the store alone now that
 * sources and chunks are persisted (A2):
 *
 *  · SOURCE coverage — declared sources present in the store ÷ declared sources. Answers "which
 *    chapters were actually run?", including the ones a failed run never reached.
 *  · CHUNK coverage — chunks that produced ≥1 grounded statement ÷ all chunks. Answers "how much of
 *    the text we did ingest became knowledge?". A barren chunk is text we read and learned nothing
 *    from, and it is listed by id, not just counted (R1).
 */
export interface CorpusCoverage {
  declaredSources: number;
  ingestedSources: number;
  missingSources: string[]; // declared refs with no Source row (sorted)
  chunks: number;
  productiveChunks: number;
  barrenChunks: string[]; // chunk ids that yielded no statement (sorted)
  sourceCoverage: number; // ingestedSources / declaredSources
  chunkCoverage: number; // productiveChunks / chunks
}

/**
 * `declaredRefs` are dataset-relative paths ("chapters/mathematics-real-numbers.md"). Matching is by
 * URI SUFFIX rather than by a re-derived id: the orchestrator hashes the path it was handed, so a
 * relative-vs-absolute invocation would silently produce a different id and report every chapter as
 * missing. Suffix matching answers the real question — is this chapter's text in the store?
 */
export async function corpusCoverage(store: KnowledgeStore, declaredRefs: string[] = []): Promise<CorpusCoverage> {
  const dump = await store.dumpAll();
  const uris = dump.sources.map((s) => s.uri ?? "");
  const present = new Set(dump.sources.map((s) => s.id));
  const missingSources = declaredRefs.filter((ref) => !uris.some((u) => u.endsWith(ref))).sort();

  const productive = new Set(dump.provenance.map((p) => p.chunkId));
  const barrenChunks = dump.sourceChunks.filter((c) => !productive.has(c.id)).map((c) => c.id).sort();

  const rate = (num: number, den: number) => (den === 0 ? 0 : num / den);
  return {
    declaredSources: declaredRefs.length,
    ingestedSources: declaredRefs.length ? declaredRefs.length - missingSources.length : present.size,
    missingSources,
    chunks: dump.sourceChunks.length,
    productiveChunks: dump.sourceChunks.length - barrenChunks.length,
    barrenChunks,
    sourceCoverage: declaredRefs.length ? rate(declaredRefs.length - missingSources.length, declaredRefs.length) : 0,
    chunkCoverage: rate(dump.sourceChunks.length - barrenChunks.length, dump.sourceChunks.length),
  };
}
