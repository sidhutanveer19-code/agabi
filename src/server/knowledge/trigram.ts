/**
 * Trigram similarity (search rung 3, §15) — Dice coefficient over character trigram sets,
 * the same measure Postgres `pg_trgm` uses. The in-memory store computes it in JS so rung 3
 * is testable offline; the Postgres store delegates to `pg_trgm` (which needs the extension —
 * a gated op, C4). Deterministic and explainable: unlike vectors (rung 4), a trigram match
 * can say WHY it matched and replays identically.
 */
export function trigrams(s: string): Set<string> {
  const t = ` ${s.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) set.add(t.slice(i, i + 3));
  return set;
}

export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}
