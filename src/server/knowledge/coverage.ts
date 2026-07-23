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
