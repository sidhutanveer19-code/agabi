import { describe, it, expect } from "vitest";
import { resolveAction, type LessonRef } from "@/server/conversation/actions";

/**
 * resolveAction — the PURE message→action decision. No model, no I/O, no clock, so
 * nothing is faked: every assertion checks the EXACT ConversationAction produced.
 * This suite attacks every branch:
 *   - the three Greet intents + unclear (constant returns)
 *   - topic/followup `.trim()` (leading/trailing whitespace stripped)
 *   - continue & clarification: active-present vs active-null fork
 *   - followup topic: `activeLesson?.topic ?? null` — active-present carries topic, null → null
 *   - switch_topic: `norm(target ?? text)` fallback (target present / target undefined),
 *     each of the THREE `.find` disjuncts isolated (exact ===, topic.includes(want),
 *     want.includes(topic)), no-match → AskForTopic, empty-lessons → AskForTopic,
 *     the `.includes("")` empty-want edge, and case/whitespace normalisation.
 */

const QUAD: LessonRef = { id: "L1", topic: "Quadratics", regionId: "r1" };
const TRIG: LessonRef = { id: "L2", topic: "Trigonometry", regionId: "r2" };
const lessons: LessonRef[] = [QUAD, TRIG];

describe("resolveAction — Greet / AskForTopic constant intents", () => {
  it("greeting → Greet (never a lesson, even with an active lesson present)", () => {
    expect(resolveAction("greeting", "hi there", "quadratics", QUAD, lessons)).toEqual({ kind: "Greet" });
  });

  it("smalltalk → Greet", () => {
    expect(resolveAction("smalltalk", "thanks that helped", undefined, QUAD, lessons)).toEqual({ kind: "Greet" });
  });

  it("pause → Greet", () => {
    expect(resolveAction("pause", "hold on", undefined, QUAD, lessons)).toEqual({ kind: "Greet" });
  });

  it("unclear → AskForTopic", () => {
    expect(resolveAction("unclear", "???", undefined, QUAD, lessons)).toEqual({ kind: "AskForTopic" });
  });
});

describe("resolveAction — topic → StartLesson (trimmed)", () => {
  it("uses the raw text as the topic", () => {
    expect(resolveAction("topic", "teach me atoms", undefined, null, [])).toEqual({
      kind: "StartLesson",
      topic: "teach me atoms",
    });
  });

  it("trims surrounding whitespace/newlines off the topic", () => {
    expect(resolveAction("topic", "\n  photosynthesis \t", undefined, null, [])).toEqual({
      kind: "StartLesson",
      topic: "photosynthesis",
    });
  });
});

describe("resolveAction — continue fork", () => {
  it("active lesson present → ContinueLesson with the active id", () => {
    expect(resolveAction("continue", "next", undefined, TRIG, lessons)).toEqual({
      kind: "ContinueLesson",
      lessonId: "L2",
    });
  });

  it("no active lesson → AskForTopic", () => {
    expect(resolveAction("continue", "next", undefined, null, lessons)).toEqual({ kind: "AskForTopic" });
  });
});

describe("resolveAction — clarification fork", () => {
  it("active lesson present → Simplify with the active id", () => {
    expect(resolveAction("clarification", "i don't get it", undefined, QUAD, lessons)).toEqual({
      kind: "Simplify",
      lessonId: "L1",
    });
  });

  it("no active lesson → AskForTopic", () => {
    expect(resolveAction("clarification", "i don't get it", undefined, null, [])).toEqual({ kind: "AskForTopic" });
  });
});

describe("resolveAction — followup → Answer(text, topic)", () => {
  it("active lesson present → topic taken from the active lesson, text trimmed", () => {
    expect(resolveAction("followup", "  why is that true? \n", undefined, QUAD, lessons)).toEqual({
      kind: "Answer",
      text: "why is that true?",
      topic: "Quadratics",
    });
  });

  it("no active lesson → topic is null (placed freely), text still trimmed", () => {
    expect(resolveAction("followup", "  what did you mean?  ", undefined, null, [])).toEqual({
      kind: "Answer",
      text: "what did you mean?",
      topic: null,
    });
  });
});

describe("resolveAction — switch_topic: target ?? text fallback", () => {
  it("target present is used (not the text) and matched case-insensitively → SwitchLesson", () => {
    // text is deliberately non-matching; only `target` matches Trigonometry.
    expect(resolveAction("switch_topic", "gibberish xyz", "TRIGONOMETRY", QUAD, lessons)).toEqual({
      kind: "SwitchLesson",
      lessonId: "L2",
    });
  });

  it("target undefined → falls back to the message text for the match", () => {
    // no target → norm(text) drives the match; text exactly names Quadratics.
    expect(resolveAction("switch_topic", "  Quadratics  ", undefined, TRIG, lessons)).toEqual({
      kind: "SwitchLesson",
      lessonId: "L1",
    });
  });
});

describe("resolveAction — switch_topic: each .find disjunct in isolation", () => {
  it("disjunct 1 — exact normalised equality (=== after norm)", () => {
    const only: LessonRef[] = [{ id: "X", topic: "Quadratics", regionId: "rx" }];
    // want 'quadratics' === norm('Quadratics'); it is NOT a strict substring case only.
    expect(resolveAction("switch_topic", "", "quadratics", null, only)).toEqual({
      kind: "SwitchLesson",
      lessonId: "X",
    });
  });

  it("disjunct 2 — topic contains want (norm(topic).includes(want), but not equal)", () => {
    const only: LessonRef[] = [{ id: "Y", topic: "The Water Cycle", regionId: "ry" }];
    // norm('The Water Cycle') !== 'water', but it DOES include 'water'.
    expect(resolveAction("switch_topic", "", "water", null, only)).toEqual({
      kind: "SwitchLesson",
      lessonId: "Y",
    });
  });

  it("disjunct 3 — want contains topic (want.includes(norm(topic)), but not the reverse)", () => {
    const only: LessonRef[] = [{ id: "Z", topic: "Cells", regionId: "rz" }];
    // norm('Cells')='cells'; 'cells' !== want and does NOT include want,
    // but the long want DOES include 'cells' → third disjunct fires.
    expect(resolveAction("switch_topic", "", "tell me about cells today please", null, only)).toEqual({
      kind: "SwitchLesson",
      lessonId: "Z",
    });
  });
});

describe("resolveAction — switch_topic: no-match & edges", () => {
  it("no lesson matches on any disjunct → AskForTopic", () => {
    expect(resolveAction("switch_topic", "", "calculus", QUAD, lessons)).toEqual({ kind: "AskForTopic" });
  });

  it("empty lessons array → .find returns undefined → AskForTopic", () => {
    expect(resolveAction("switch_topic", "anything", "anything", QUAD, [])).toEqual({ kind: "AskForTopic" });
  });

  it("empty-string target ('' is not nullish, so ?? keeps it) matches the FIRST lesson via .includes('')", () => {
    // norm('') === '' ; 'quadratics'.includes('') === true → first lesson matches by construction.
    expect(resolveAction("switch_topic", "nonmatching text", "", QUAD, lessons)).toEqual({
      kind: "SwitchLesson",
      lessonId: "L1",
    });
  });

  it("whitespace-only target normalises to '' and likewise matches the first lesson", () => {
    expect(resolveAction("switch_topic", "nonmatching", "   \t ", null, lessons)).toEqual({
      kind: "SwitchLesson",
      lessonId: "L1",
    });
  });

  it(".find returns the FIRST matching lesson when a later one would also match", () => {
    const many: LessonRef[] = [
      { id: "A", topic: "Algebra Basics", regionId: "ra" },
      { id: "B", topic: "Algebra Advanced", regionId: "rb" },
    ];
    // want 'algebra' is a substring of BOTH topics; first (A) wins.
    expect(resolveAction("switch_topic", "", "algebra", null, many)).toEqual({
      kind: "SwitchLesson",
      lessonId: "A",
    });
  });
});
