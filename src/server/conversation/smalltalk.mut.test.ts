import { describe, it, expect } from "vitest";
import { smallTalkReply } from "@/server/conversation/smalltalk";

/**
 * Mutation-hardening for smalltalk.ts — the general/meta-question replies ("what's your name",
 * "how are you", "what can you do", "thanks", "bye", bare greeting). The sibling smalltalk.test.ts
 * proves rotation + non-empty + no-throw; THIS file pins the EXACT text of every branch and the
 * exact rotation indices, so a mutation that blanks a string, flips a branch condition, drops
 * .trim()/.toLowerCase(), or breaks the pick() index math turns a test red.
 */

const INVITE = "What would you like to learn?";

describe("smallTalkReply — exact per-branch text at turn 0 (kills StringLiteral + branch-condition mutants)", () => {
  it("name / who-are-you → exact identity reply", () => {
    const expected = `I'm Agabi — your learning canvas. I teach any Class-10 topic with diagrams and worked examples. ${INVITE}`;
    expect(smallTalkReply("what's your name", 0)).toBe(expected);
    expect(smallTalkReply("who are you", 0)).toBe(expected);
    expect(smallTalkReply("who made you", 0)).toBe(expected);
  });

  it("how-are-you → exact wellbeing reply", () => {
    expect(smallTalkReply("how are you", 0)).toBe(`Doing great and ready to teach. ${INVITE}`);
    expect(smallTalkReply("how's it going", 0)).toBe(`Doing great and ready to teach. ${INVITE}`);
  });

  it("capabilities → exact capability reply", () => {
    const expected = `I explain any Class-10 topic as a visual lesson — grounded in your NCERT textbook, in plain words. ${INVITE}`;
    expect(smallTalkReply("what can you do", 0)).toBe(expected);
    expect(smallTalkReply("can you help me", 0)).toBe(expected);
    expect(smallTalkReply("how do you work", 0)).toBe(expected);
  });

  it("thanks → exact gratitude reply", () => {
    expect(smallTalkReply("thanks", 0)).toBe(`Anytime! ${INVITE}`);
    expect(smallTalkReply("thank you", 0)).toBe(`Anytime! ${INVITE}`);
  });

  it("bye → exact farewell reply", () => {
    expect(smallTalkReply("bye", 0)).toBe(`See you soon — come back whenever you want to learn something.`);
    expect(smallTalkReply("see you", 0)).toBe(`See you soon — come back whenever you want to learn something.`);
  });

  it("bare greeting / unmatched meta → exact hot-path default", () => {
    expect(smallTalkReply("hi", 0)).toBe(`Hi — I'm Agabi. ${INVITE}`);
    expect(smallTalkReply("yo", 0)).toBe(`Hi — I'm Agabi. ${INVITE}`);
    expect(smallTalkReply("sup", 0)).toBe(`Hi — I'm Agabi. ${INVITE}`);
  });
});

describe("smallTalkReply — input coercion (kills .trim()/.toLowerCase()/?? mutants)", () => {
  it("trims surrounding whitespace before matching (drop .trim() → these would miss the branch)", () => {
    expect(smallTalkReply("   how are you   ", 0)).toBe(`Doing great and ready to teach. ${INVITE}`);
  });
  it("lowercases before matching (drop .toLowerCase() → uppercase would miss the branch)", () => {
    const expected = `I'm Agabi — your learning canvas. I teach any Class-10 topic with diagrams and worked examples. ${INVITE}`;
    expect(smallTalkReply("WHAT'S YOUR NAME", 0)).toBe(expected);
    expect(smallTalkReply("How Are You", 0)).toBe(`Doing great and ready to teach. ${INVITE}`);
  });
});

describe("smallTalkReply — pick() rotation index math (kills pick() mutants)", () => {
  it("turn 0 vs turn 1 select the exact consecutive variants of the greeting", () => {
    expect(smallTalkReply("hi", 0)).toBe(`Hi — I'm Agabi. ${INVITE}`);
    expect(smallTalkReply("hi", 1)).toBe(`Hey again! Tell me a topic — like "real numbers" or "photosynthesis" — and I'll teach it.`);
    expect(smallTalkReply("hi", 2)).toBe(`Still here and ready. What should we learn?`);
    expect(smallTalkReply("hi", 3)).toBe(`Give me any Class-10 topic and I'll build you a visual lesson.`);
  });
  it("index wraps modulo the variant count (turn 4 collapses back to variant 0)", () => {
    expect(smallTalkReply("hi", 4)).toBe(smallTalkReply("hi", 0));
  });
  it("non-finite / non-positive turn falls to variant 0 — NOT undefined (kills && → || and Conditional → true)", () => {
    const v0 = `Hi — I'm Agabi. ${INVITE}`;
    expect(smallTalkReply("hi", Infinity)).toBe(v0);
    expect(smallTalkReply("hi", NaN)).toBe(v0);
    expect(smallTalkReply("hi", -5)).toBe(v0);
    expect(smallTalkReply("hi", 0)).toBe(v0);
  });
});

// ---------------------------------------------------------------------------
// Added mutation-kill coverage: the sibling asserts above only pin turn-0 text,
// so the SECOND/THIRD phrasing of every non-default branch (the variant-1/2
// StringLiteral lines) was never asserted → those blank-string mutants survived.
// The blocks below pin every remaining variant + re-pin the branch/guard seams.
// ---------------------------------------------------------------------------

describe("smallTalkReply — turn>=1 variant text per non-default branch (kills variant-1/2 StringLiteral->`` )", () => {
  it("identity branch, turn 1 → exact 2nd phrasing (kills L28 blank)", () => {
    expect(smallTalkReply("who are you", 1)).toBe(
      `Agabi's the name — a visual tutor for Class-10, built to make hard topics click. ${INVITE}`,
    );
  });
  it("how-are-you branch, turn 1 & 2 → exact 2nd/3rd phrasings (kills L33 + L34 blanks)", () => {
    expect(smallTalkReply("how are you", 1)).toBe(
      `All good here — more importantly, what do you want to understand today?`,
    );
    expect(smallTalkReply("how are you", 2)).toBe(
      `Sharp and ready. Give me a topic and I'll break it down.`,
    );
  });
  it("capabilities branch, turn 1 → exact 2nd phrasing (kills L39 blank)", () => {
    expect(smallTalkReply("what can you do", 1)).toBe(
      `I turn any Class-10 topic into a visual, worked-out lesson from your NCERT book. Name one and watch.`,
    );
  });
  it("thanks branch, turn 1 → exact 2nd phrasing (kills L42 blank)", () => {
    expect(smallTalkReply("thanks", 1)).toBe(`Glad it helped — want to go deeper or try a new topic?`);
  });
  it("bye branch, turn 1 → exact 2nd phrasing (kills L46 blank)", () => {
    expect(smallTalkReply("bye", 1)).toBe(`Later! I'll be here when you want to learn.`);
  });
});

describe("smallTalkReply — each branch routes to its OWN reply, not the default (kills ConditionalExpression->false)", () => {
  // Forcing any `if (has(...))` to false makes that input fall through to the default greeting.
  // Pinning the exact branch reply — which the greeting never equals — turns that mutation red.
  const identityV0 = `I'm Agabi — your learning canvas. I teach any Class-10 topic with diagrams and worked examples. ${INVITE}`;
  const capV0 = `I explain any Class-10 topic as a visual lesson — grounded in your NCERT textbook, in plain words. ${INVITE}`;
  const greetingV0 = `Hi — I'm Agabi. ${INVITE}`;

  it("identity if (L25) fires for 'who are you' — not the greeting", () => {
    expect(smallTalkReply("who are you", 0)).toBe(identityV0);
    expect(smallTalkReply("who are you", 0)).not.toBe(greetingV0);
  });
  it("how-are-you if (L30) fires — not the greeting", () => {
    expect(smallTalkReply("how are you", 0)).toBe(`Doing great and ready to teach. ${INVITE}`);
    expect(smallTalkReply("how are you", 0)).not.toBe(greetingV0);
  });
  it("capabilities if (L36) fires — not the greeting", () => {
    expect(smallTalkReply("what can you do", 0)).toBe(capV0);
    expect(smallTalkReply("what can you do", 0)).not.toBe(greetingV0);
  });
  it("thanks if (L41) fires — not the greeting", () => {
    expect(smallTalkReply("thanks", 0)).toBe(`Anytime! ${INVITE}`);
    expect(smallTalkReply("thanks", 0)).not.toBe(greetingV0);
  });
  it("bye if (L43) fires — not the greeting", () => {
    expect(smallTalkReply("bye", 0)).toBe(`See you soon — come back whenever you want to learn something.`);
    expect(smallTalkReply("bye", 0)).not.toBe(greetingV0);
  });
});

describe("smallTalkReply — has()/coercion internals (kills ArrowFunction / some->every / toUpperCase / ?? mutants)", () => {
  const identityV0 = `I'm Agabi — your learning canvas. I teach any Class-10 topic with diagrams and worked examples. ${INVITE}`;

  it("multi-keyword branch matches on ANY keyword, not ALL (kills .some → .every at L23:35)", () => {
    // 'who are you' is ONLY the 2nd of six identity keywords; `.every` would demand all six.
    expect(smallTalkReply("who are you", 0)).toBe(identityV0);
    // 'your creator' is the LAST of the six and also matches on its own.
    expect(smallTalkReply("your creator", 0)).toBe(identityV0);
  });
  it("has() actually inspects the text (kills () => undefined arrow bodies at L23:15 & L23:42)", () => {
    // If has() were always undefined/false, EVERY input would collapse to the greeting.
    expect(smallTalkReply("thanks", 0)).toBe(`Anytime! ${INVITE}`);
    expect(smallTalkReply("bye", 0)).toBe(`See you soon — come back whenever you want to learn something.`);
  });
  it("text is lowercased before matching (kills toLowerCase→toUpperCase AND drop-.trim().toLowerCase() at L22:13)", () => {
    // Uppercase input only matches after a real .toLowerCase(); either L22:13 mutant leaves it uppercase → greeting.
    expect(smallTalkReply("WHO MADE YOU", 0)).toBe(identityV0);
    expect(smallTalkReply("THANKS", 0)).toBe(`Anytime! ${INVITE}`);
  });
  it("null-coalescing keeps the real text (kills ?? → && at L22:20)", () => {
    // `text && ""` turns any truthy string into '' → greeting; the real `??` keeps the keyword.
    expect(smallTalkReply("how are you", 0)).toBe(`Doing great and ready to teach. ${INVITE}`);
  });
});

describe("smallTalkReply — pick() guard boundaries (kills L16 logical/conditional mutants)", () => {
  const v0 = `Hi — I'm Agabi. ${INVITE}`;
  const v1 = `Hey again! Tell me a topic — like "real numbers" or "photosynthesis" — and I'll teach it.`;

  it("positive finite turn selects the matching variant (guard true path)", () => {
    expect(smallTalkReply("hi", 1)).toBe(v1);
  });
  it("Infinity turn → variant 0, NOT undefined (kills && → || at L16:13)", () => {
    // With `||`, isFinite(Inf)||Inf>0 = true → i = floor(Inf) = Infinity → variants[NaN] = undefined.
    expect(smallTalkReply("hi", Infinity)).toBe(v0);
  });
  it("negative turn → variant 0, NOT undefined (kills whole-condition→true L16:13 and turn>0→true L16:38)", () => {
    // Forcing the guard true makes i = floor(-3) = -3 → variants[-3 % 4 = -3] = undefined.
    expect(smallTalkReply("hi", -3)).toBe(v0);
  });
  it("NaN turn → variant 0, NOT undefined (kills whole-condition → true at L16:13)", () => {
    expect(smallTalkReply("hi", NaN)).toBe(v0);
  });
});
