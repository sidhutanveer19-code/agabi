import { describe, it, expect } from "vitest";
import { resolveAction, type LessonRef } from "@/server/conversation/actions";

const L: LessonRef = { id: "L1", topic: "Quadratics", regionId: "r1" };
const lessons: LessonRef[] = [L, { id: "L2", topic: "Trigonometry", regionId: "r2" }];

describe("resolveAction — pure, every branch covered", () => {
  it("greeting / smalltalk / pause → Greet (never a lesson)", () => {
    for (const i of ["greeting", "smalltalk", "pause"] as const) {
      expect(resolveAction(i, "hi", undefined, null, []).kind).toBe("Greet");
    }
  });

  it("unclear → AskForTopic", () => {
    expect(resolveAction("unclear", "???", undefined, null, []).kind).toBe("AskForTopic");
  });

  it("topic → StartLesson with the message text", () => {
    expect(resolveAction("topic", "teach me atoms", undefined, null, [])).toEqual({ kind: "StartLesson", topic: "teach me atoms" });
  });

  it("continue → ContinueLesson with active; AskForTopic without", () => {
    expect(resolveAction("continue", "", undefined, L, lessons)).toEqual({ kind: "ContinueLesson", lessonId: "L1" });
    expect(resolveAction("continue", "", undefined, null, []).kind).toBe("AskForTopic");
  });

  it("clarification → Simplify with active; AskForTopic without", () => {
    expect(resolveAction("clarification", "", undefined, L, lessons)).toEqual({ kind: "Simplify", lessonId: "L1" });
    expect(resolveAction("clarification", "", undefined, null, []).kind).toBe("AskForTopic");
  });

  it("followup → Answer(topic) with active; Answer(null) without (placed freely)", () => {
    expect(resolveAction("followup", "why?", undefined, L, lessons)).toEqual({ kind: "Answer", text: "why?", topic: "Quadratics" });
    expect(resolveAction("followup", "why?", undefined, null, [])).toEqual({ kind: "Answer", text: "why?", topic: null });
  });

  it("switch_topic → SwitchLesson on match (in code); AskForTopic with no match", () => {
    expect(resolveAction("switch_topic", "continue quadratics", "quadratics", L, lessons)).toEqual({ kind: "SwitchLesson", lessonId: "L1" });
    expect(resolveAction("switch_topic", "continue Quadratics", "Quadratics", L, lessons).kind).toBe("SwitchLesson"); // case-insensitive
    expect(resolveAction("switch_topic", "continue calculus", "calculus", L, lessons).kind).toBe("AskForTopic");
  });
});
