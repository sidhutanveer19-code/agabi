/**
 * Pure, deterministic replies for general / meta questions ("what's your name", "how are you",
 * "what can you do"). Routed from the greeting/smalltalk intents so Agabi answers like a smart
 * assistant instead of trying to TEACH the question as a topic (the "hi got taught" class of bug,
 * see actions.ts). No model, no I/O — every branch is unit-testable.
 */
const INVITE = "What would you like to learn?";

export function smallTalkReply(text: string): string {
  // Request-path helper: NEVER throw. Coerce anything (undefined/null/non-string) to a safe string.
  const t = String(text ?? "").trim().toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));

  if (has("your name", "who are you", "what are you", "who made", "who built", "your creator"))
    return `I'm Agabi — your learning canvas. I teach any Class-10 topic with diagrams and worked examples. ${INVITE}`;
  if (has("how are you", "how's it going", "how do you do", "you good", "how you doing"))
    return `Doing great and ready to teach. ${INVITE}`;
  if (has("what can you do", "what do you do", "can you help", "capabilit", "how do you work"))
    return `I explain any Class-10 topic as a visual lesson — grounded in your NCERT textbook, in plain words. ${INVITE}`;
  if (has("thank"))
    return `Anytime! ${INVITE}`;
  if (has("bye", "goodbye", "see you", "see ya"))
    return `See you soon — come back whenever you want to learn something.`;

  // bare greeting / any other meta chatter → friendly, always pivots to learning
  return `Hi — I'm Agabi. ${INVITE}`;
}
