/**
 * Stable id generation for regions and blocks.
 *
 * A monotonic counter guarantees unique, ordered ids within a session without
 * relying on Math.random/Date.now at module load (keeps ids deterministic per
 * process and avoids SSR/hydration surprises).
 */
let seq = 0;

/** Next monotonic sequence number. */
export function nextSeq(): number {
  seq += 1;
  return seq;
}

/** Create a namespaced unique id, e.g. `region_1`, `block_42`. */
export function createId(prefix: string): string {
  return `${prefix}_${nextSeq()}`;
}

/** Extract the trailing numeric suffix of an id (`region_7` → 7; 0 if none). */
export function idSuffix(id: string): number {
  const m = /_(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/**
 * Advance the counter so it never re-issues an id already present in restored
 * data. Called after loading a persisted document — without it the counter
 * resets to 0 on page load and collides with restored `region_1`/`block_1` ids.
 */
export function ensureSeqAbove(n: number): void {
  if (n > seq) seq = n;
}
