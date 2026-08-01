/**
 * Diversity KPI — a re-ask must be explained DIFFERENTLY. (L1: sameness is a measured number; L5: the
 * ONE place this KPI is computed.) diversity = 1 − Jaccard(tokens(prev), tokens(current)), where tokens
 * are lowercased alphanumeric words. No I/O, no model — pure, total: both empty → 0 (nothing changed),
 * never NaN / divide-by-zero.
 */

// A re-explanation must clear this diversity floor to count as "explained differently".
export const MIN_DIVERSITY = 0.3;

/** Lowercased alphanumeric word tokens as a set (order- and duplicate-free). */
function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** 1 − Jaccard overlap of the two token sets. Identical non-empty → 0; fully disjoint → 1; both
 *  empty → 0 (an empty union means nothing changed, so we return 0 rather than divide by zero). */
export function diversity(prev: string, current: string): number {
  const a = tokenSet(prev);
  const b = tokenSet(current);

  const union = new Set<string>([...a, ...b]);
  if (union.size === 0) return 0; // both empty — nothing changed

  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;

  return 1 - intersection / union.size;
}

/** True iff `current` is a sufficiently different re-explanation of `prev` (diversity >= the floor). */
export function isSufficientlyDifferent(prev: string, current: string): boolean {
  return diversity(prev, current) >= MIN_DIVERSITY;
}
