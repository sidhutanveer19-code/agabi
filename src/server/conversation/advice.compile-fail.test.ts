import { describe, it, expect } from "vitest";
import { advise } from "@/server/advisors/advice";
import { createLesson, setLessonState } from "@/server/conversation/lessonRepo";
import type { IntentAdvice } from "@/server/advisors/intent";

/**
 * COMPILE-TIME proof of the branded-type wall. Each `@ts-expect-error` MUST error —
 * if it doesn't, tsc fails on the unused directive, which IS the test. None of these
 * run (they're inside un-invoked thunks); the point is that they don't COMPILE.
 */
describe("branded types — raw Advice cannot reach a state mutator", () => {
  it("createLesson refuses Advice where `topic: string` is required", () => {
    const a = advise<IntentAdvice>({ intent: "topic" });
    // @ts-expect-error — Advice is not a string; passing model output into a mutator must not compile
    void (() => createLesson("u", "c", a, "r", []));
    expect(true).toBe(true);
  });

  it("setLessonState refuses Advice where a plain LessonState is required", () => {
    const a = advise<"PLANNING">("PLANNING");
    // @ts-expect-error — Advice is not a LessonState; a model can't set state
    void (() => setLessonState("L1", a));
    expect(true).toBe(true);
  });
});
