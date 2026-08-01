import type { Context } from "@/server/knowledge/types";

/**
 * Context specificity matching (§13.2/§15). A query context (what the learner is in)
 * is matched against stored contexts (what a statement/asset was asserted for). A
 * candidate is *applicable* when it does not contradict the query on any shared
 * dimension; among applicable candidates, the MOST specific (most dimensions matched)
 * wins. A candidate with a dimension the query lacks is NOT applicable — it asserts a
 * condition the learner has not declared.
 *
 * Pure and table-driven so the `context-canonical`/matching behaviour is a snapshot,
 * not a model call. Fuller ranking (partial credit, weighting) lands with search (M4).
 */

/** True when `candidate` may be served to a learner in `query` context. */
export function isApplicable(query: Context, candidate: Context): boolean {
  for (const [k, v] of Object.entries(candidate.dimensions)) {
    if (!(k in query.dimensions)) return false; // candidate is narrower than the learner declared
    if (!valueEquals(query.dimensions[k], v)) return false; // direct contradiction on a shared axis
  }
  return true;
}

/** Number of dimensions the candidate pins — its specificity score. Higher = more specific. */
export function specificity(candidate: Context): number {
  return Object.keys(candidate.dimensions).length;
}

/**
 * Rank applicable candidates most-specific first. Ties broken by context id so the
 * order is deterministic (required for replayable path selection, §18B.3).
 */
export function rankByContext(query: Context, candidates: Context[]): Context[] {
  return candidates
    .filter((c) => isApplicable(query, c))
    .sort((a, b) => specificity(b) - specificity(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function valueEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
