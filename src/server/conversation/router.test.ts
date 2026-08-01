import { describe, it, expect, vi } from "vitest";
import { route, CORPUS_MIN_HITS } from "@/server/conversation/router";
import { understandIntent } from "@/server/conversation/understand";
import type { LessonRef } from "@/server/conversation/actions";

/**
 * The Capability Router (L3: measure the DECISION). The one new invariant vs the pure
 * resolveAction: a NEW lesson is started ONLY if the topic has corpus support — an
 * off-syllabus topic is refused, never taught. So Wrong-Teaching-Rate stays provably 0.
 * corpusHits is the sole I/O edge and is injected as a fake here.
 */
const NO_LESSON: LessonRef | null = null;
const NO_LESSONS: LessonRef[] = [];

describe("route — corpus-gated capability routing", () => {
  it("an IN-corpus topic (hits ≥ threshold) → StartLesson", async () => {
    const hits = vi.fn(async () => 5);
    const io = understandIntent("topic", "photosynthesis");
    const a = await route(io, "photosynthesis", NO_LESSON, NO_LESSONS, hits);
    expect(a.kind).toBe("StartLesson");
    expect(hits).toHaveBeenCalledWith("photosynthesis");
  });

  it("an OFF-syllabus topic (0 hits) → RefuseOffSyllabus, NEVER StartLesson (Wrong-Teaching=0)", async () => {
    const hits = vi.fn(async () => 0);
    const io = understandIntent("topic", "quantum entanglement");
    const a = await route(io, "quantum entanglement", NO_LESSON, NO_LESSONS, hits);
    expect(a.kind).toBe("RefuseOffSyllabus");
    if (a.kind === "RefuseOffSyllabus") expect(a.topic).toBe("quantum entanglement");
  });

  it("the corpus gate fires EXACTLY at the threshold (mutation guard on `< CORPUS_MIN_HITS`)", async () => {
    const io = understandIntent("topic", "algebra");
    const below = await route(io, "algebra", NO_LESSON, NO_LESSONS, async () => CORPUS_MIN_HITS - 1);
    const at = await route(io, "algebra", NO_LESSON, NO_LESSONS, async () => CORPUS_MIN_HITS);
    expect(below.kind).toBe("RefuseOffSyllabus");
    expect(at.kind).toBe("StartLesson");
  });

  it("greeting/smalltalk/unclear NEVER consult corpus and NEVER teach", async () => {
    const hits = vi.fn(async () => 999);
    for (const intent of ["greeting", "smalltalk", "unclear"] as const) {
      const io = understandIntent(intent, "hi there");
      const a = await route(io, "hi there", NO_LESSON, NO_LESSONS, hits);
      expect(["Greet", "AskForTopic"]).toContain(a.kind);
    }
    expect(hits).not.toHaveBeenCalled(); // no corpus lookup for non-topic intents
  });

  it("a non-topic intent delegates to resolveAction unchanged (followup → Answer)", async () => {
    const io = understandIntent("followup", "why is that true?");
    const a = await route(io, "why is that true?", NO_LESSON, NO_LESSONS, async () => 0);
    expect(a.kind).toBe("Answer");
  });
});
