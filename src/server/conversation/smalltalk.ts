/**
 * Pure, deterministic replies for general / meta questions ("what's your name", "how are you",
 * "what can you do"). Routed from the greeting/smalltalk intents so Agabi answers like a smart
 * assistant instead of trying to TEACH the question as a topic (the "hi got taught" class of bug,
 * see actions.ts). No model, no I/O — every branch is unit-testable.
 *
 * NO VERBATIM REPEAT (the "hi hi hi → same thing" bug): each branch holds several phrasings and picks
 * by `turn` (the per-canvas turn count). Consecutive replies to the same input differ, so it never
 * echoes itself. Deterministic given (text, turn) — a fixed turn always yields the same phrasing, so
 * it stays unit-testable (no randomness).
 */
const INVITE = "What would you like to learn?";

/** Deterministic rotation: pick the phrasing for this turn (wraps; safe for any non-negative int). */
function pick(variants: string[], turn: number): string {
  const i = Number.isFinite(turn) && turn > 0 ? Math.floor(turn) : 0;
  return variants[i % variants.length];
}

export function smallTalkReply(text: string, turn = 0): string {
  // Request-path helper: NEVER throw. Coerce anything (undefined/null/non-string) to a safe string.
  const t = String(text ?? "").trim().toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));

  if (has("your name", "who are you", "what are you", "who made", "who built", "your creator"))
    return pick([
      `I'm Agabi — your learning canvas. I teach any Class-10 topic with diagrams and worked examples. ${INVITE}`,
      `Agabi's the name — a visual tutor for Class-10, built to make hard topics click. ${INVITE}`,
    ], turn);
  if (has("how are you", "how's it going", "how do you do", "you good", "how you doing"))
    return pick([
      `Doing great and ready to teach. ${INVITE}`,
      `All good here — more importantly, what do you want to understand today?`,
      `Sharp and ready. Give me a topic and I'll break it down.`,
    ], turn);
  if (has("what can you do", "what do you do", "can you help", "capabilit", "how do you work"))
    return pick([
      `I explain any Class-10 topic as a visual lesson — grounded in your NCERT textbook, in plain words. ${INVITE}`,
      `I turn any Class-10 topic into a visual, worked-out lesson from your NCERT book. Name one and watch.`,
    ], turn);
  if (has("thank"))
    return pick([`Anytime! ${INVITE}`, `Glad it helped — want to go deeper or try a new topic?`], turn);
  if (has("bye", "goodbye", "see you", "see ya"))
    return pick([
      `See you soon — come back whenever you want to learn something.`,
      `Later! I'll be here when you want to learn.`,
    ], turn);

  // bare greeting / any other meta chatter → friendly, always pivots to learning. This is the hot path
  // (the "hi" the user typed repeatedly), so it carries the most variants — no two consecutive repeats.
  return pick([
    `Hi — I'm Agabi. ${INVITE}`,
    `Hey again! Tell me a topic — like "real numbers" or "photosynthesis" — and I'll teach it.`,
    `Still here and ready. What should we learn?`,
    `Give me any Class-10 topic and I'll build you a visual lesson.`,
  ], turn);
}
