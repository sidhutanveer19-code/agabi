/**
 * Adaptivity (Phase 2, Step 6). When a student re-asks — "explain it again", a repeat lesson on the
 * same topic — the explanation must come from a DIFFERENT angle, or it's the same wall of text that
 * already failed them. This is the pure rotation that guarantees it; the Evaluation Engine measures
 * the result as Diversity = 1 − similarity(previous, current) and gates on it.
 *
 * Deterministic on purpose: attempt N always yields the same lens, so a re-ask is reproducible and
 * the diversity metric is stable across runs. attempt 0 is the FIRST teaching (no forced lens — the
 * default mentor lesson); every attempt after that rotates through distinct framings.
 */
export const ANGLES: string[] = [
  "Re-teach it from a DIFFERENT angle than before: lead with a concrete real-world example first, then draw out the idea.",
  "Re-teach it as a step-by-step story of what happens and why, not as a definition.",
  "Re-teach it by contrast: show what it is NOT and the mistake most students make, then correct it.",
  "Re-teach it with a fresh everyday ANALOGY you did not use before, then map each part back to the idea.",
  "Re-teach it backwards: start from the result the student wants, and work back to the mechanism.",
];

/** PURE. attempt ≤ 0 → no forced angle (default lesson). attempt N ≥ 1 → a distinct rotated lens. */
export function teachingAngle(attempt: number): string {
  if (attempt <= 0) return "";
  return ANGLES[(attempt - 1) % ANGLES.length];
}
