import { describe, it, expect } from "vitest";
import { replay, type ReplayEvent, type LessonSnapshot } from "@/server/evidence/replay";
import { EVENTS } from "@/server/events";

/**
 * §H1 coverage suite for replay.ts — exercises EVERY branch of the pure reducer:
 * the seq coercion (asBig: bigint | number | string), the record/str/num guards
 * (null/primitive payloads, NaN/Infinity, the slot-index-0 boundary), the sort
 * comparator (<, >, equal-seq stability), the lessonId first-wins guard, all 11
 * switch cases, and the unhandled-event fall-through. Asserts exact values so a
 * mutation of the reducer flips a test red.
 */

const ev = (type: string, seq: bigint | number | string, payload: unknown, lessonId: string | null = "L1"): ReplayEvent => ({
  type,
  seq,
  payload,
  lessonId,
});

const empty: LessonSnapshot = {
  lessonId: null,
  requestText: null,
  routing: null,
  topic: null,
  states: [],
  finalState: null,
  cursor: 0,
  slots: [],
  providers: [],
  outcome: null,
  errors: [],
};

describe("replay — empty + default snapshot", () => {
  it("returns the fully-null snapshot for zero events", () => {
    expect(replay([])).toEqual(empty);
  });
});

describe("replay — seq coercion (asBig) + ordering", () => {
  it("orders by numeric seq (number, not bigint/string)", () => {
    const snap = replay([
      ev(EVENTS.lessonState, 2, { to: "TEACHING" }),
      ev(EVENTS.lessonState, 1, { to: "PLANNING" }),
    ]);
    expect(snap.states).toEqual(["PLANNING", "TEACHING"]);
    expect(snap.finalState).toBe("TEACHING");
  });

  it("orders by bigint seq", () => {
    const snap = replay([
      ev(EVENTS.lessonState, BigInt(20), { to: "SECOND" }),
      ev(EVENTS.lessonState, BigInt(10), { to: "FIRST" }),
    ]);
    expect(snap.states).toEqual(["FIRST", "SECOND"]);
  });

  it("orders correctly when seq arrives as a JSON string", () => {
    const snap = replay([
      ev(EVENTS.lessonState, "2", { to: "B" }),
      ev(EVENTS.lessonState, "10", { to: "C" }),
      ev(EVENTS.lessonState, "1", { to: "A" }),
    ]);
    // String compare would order "10" < "2"; BigInt compare must give A,B,C.
    expect(snap.states).toEqual(["A", "B", "C"]);
  });

  it("orders a mix of bigint, number, and string seq together", () => {
    const snap = replay([
      ev(EVENTS.lessonState, "3", { to: "three" }),
      ev(EVENTS.lessonState, BigInt(1), { to: "one" }),
      ev(EVENTS.lessonState, 2, { to: "two" }),
    ]);
    expect(snap.states).toEqual(["one", "two", "three"]);
  });

  it("preserves input order for equal seq (stable sort, comparator === branch)", () => {
    const snap = replay([
      ev(EVENTS.lessonState, 5, { to: "FIRST_IN" }),
      ev(EVENTS.lessonState, 5, { to: "SECOND_IN" }),
    ]);
    expect(snap.states).toEqual(["FIRST_IN", "SECOND_IN"]);
    expect(snap.finalState).toBe("SECOND_IN");
  });

  it("does NOT mutate the caller's array (spread copy before sort)", () => {
    const input = [
      ev(EVENTS.lessonState, 2, { to: "B" }),
      ev(EVENTS.lessonState, 1, { to: "A" }),
    ];
    replay(input);
    // The original array order is unchanged — replay sorts a copy.
    expect(input.map((e) => (e.payload as { to: string }).to)).toEqual(["B", "A"]);
  });
});

describe("replay — lessonId first-wins guard", () => {
  it("takes the first non-null lessonId and never overwrites it", () => {
    const snap = replay([
      ev(EVENTS.requestReceived, 1, { text: "hi" }, null), // null lessonId — skipped
      ev(EVENTS.lessonState, 2, { to: "PLANNING" }, "lesson_A"), // first non-null wins
      ev(EVENTS.lessonState, 3, { to: "TEACHING" }, "lesson_B"), // ignored — already set
    ]);
    expect(snap.lessonId).toBe("lesson_A");
  });

  it("leaves lessonId null when every event has a null/absent lessonId", () => {
    const snap = replay([
      ev(EVENTS.requestReceived, 1, { text: "hi" }, null),
      { type: EVENTS.lessonState, seq: 2, payload: { to: "PLANNING" } }, // lessonId absent
    ]);
    expect(snap.lessonId).toBeNull();
  });
});

describe("replay — requestReceived / commandSent", () => {
  it("captures request text and routing action", () => {
    const snap = replay([
      ev(EVENTS.requestReceived, 1, { text: "teach me trig" }),
      ev(EVENTS.commandSent, 2, { action: "StartLesson" }),
    ]);
    expect(snap.requestText).toBe("teach me trig");
    expect(snap.routing).toBe("StartLesson");
  });

  it("keeps the earlier text when a later requestReceived carries none (nullish coalesce)", () => {
    const snap = replay([
      ev(EVENTS.requestReceived, 1, { text: "first" }),
      ev(EVENTS.requestReceived, 2, {}), // no text — must keep "first"
    ]);
    expect(snap.requestText).toBe("first");
  });

  it("ignores a non-string text (str guard) — requestText stays null", () => {
    const snap = replay([ev(EVENTS.requestReceived, 1, { text: 123 })]);
    expect(snap.requestText).toBeNull();
  });

  it("keeps earlier routing when a later commandSent has no action", () => {
    const snap = replay([
      ev(EVENTS.commandSent, 1, { action: "AnswerQuestion" }),
      ev(EVENTS.commandSent, 2, {}),
    ]);
    expect(snap.routing).toBe("AnswerQuestion");
  });
});

describe("replay — lessonStarted redundant fields", () => {
  it("fills topic + requestText + routing from lesson.started when the turn-level events are absent", () => {
    const snap = replay([
      ev(EVENTS.lessonStarted, 1, { topic: "quadratics", requestText: "explain quadratics", routing: "StartLesson" }),
    ]);
    expect(snap.topic).toBe("quadratics");
    expect(snap.requestText).toBe("explain quadratics");
    expect(snap.routing).toBe("StartLesson");
  });

  it("does NOT override an already-set requestText/routing from the turn-level events", () => {
    const snap = replay([
      ev(EVENTS.requestReceived, 1, { text: "turn-level text" }),
      ev(EVENTS.commandSent, 2, { action: "turn-level-routing" }),
      ev(EVENTS.lessonStarted, 3, { topic: "t", requestText: "redundant", routing: "redundant-routing" }),
    ]);
    expect(snap.requestText).toBe("turn-level text");
    expect(snap.routing).toBe("turn-level-routing");
    expect(snap.topic).toBe("t");
  });

  it("leaves topic/requestText/routing null when lesson.started carries none of them", () => {
    const snap = replay([ev(EVENTS.lessonStarted, 1, {})]);
    expect(snap.topic).toBeNull();
    expect(snap.requestText).toBeNull();
    expect(snap.routing).toBeNull();
  });

  it("keeps a prior topic when a later lesson.started omits the topic", () => {
    const snap = replay([
      ev(EVENTS.lessonStarted, 1, { topic: "first-topic" }),
      ev(EVENTS.lessonStarted, 2, {}),
    ]);
    expect(snap.topic).toBe("first-topic");
  });
});

describe("replay — lessonState", () => {
  it("pushes each transition target and tracks finalState as the last one", () => {
    const snap = replay([
      ev(EVENTS.lessonState, 1, { from: "IDLE", to: "PLANNING" }),
      ev(EVENTS.lessonState, 2, { from: "PLANNING", to: "TEACHING" }),
      ev(EVENTS.lessonState, 3, { from: "TEACHING", to: "DONE" }),
    ]);
    expect(snap.states).toEqual(["PLANNING", "TEACHING", "DONE"]);
    expect(snap.finalState).toBe("DONE");
  });

  it("skips a lesson.state with no `to` field (guard) — not pushed, finalState unchanged", () => {
    const snap = replay([
      ev(EVENTS.lessonState, 1, { to: "PLANNING" }),
      ev(EVENTS.lessonState, 2, { from: "PLANNING" }), // no `to`
    ]);
    expect(snap.states).toEqual(["PLANNING"]);
    expect(snap.finalState).toBe("PLANNING");
  });

  it("skips a lesson.state whose `to` is a non-string", () => {
    const snap = replay([ev(EVENTS.lessonState, 1, { to: 42 })]);
    expect(snap.states).toEqual([]);
    expect(snap.finalState).toBeNull();
  });
});

describe("replay — lessonCursor", () => {
  it("records the latest cursor value", () => {
    const snap = replay([
      ev(EVENTS.lessonCursor, 1, { cursor: 3 }),
      ev(EVENTS.lessonCursor, 2, { cursor: 7 }),
    ]);
    expect(snap.cursor).toBe(7);
  });

  it("accepts cursor 0 (?? not ||) — overwrites a prior non-zero cursor", () => {
    const snap = replay([
      ev(EVENTS.lessonCursor, 1, { cursor: 5 }),
      ev(EVENTS.lessonCursor, 2, { cursor: 0 }),
    ]);
    expect(snap.cursor).toBe(0);
  });

  it("keeps the prior cursor when a later event omits cursor", () => {
    const snap = replay([
      ev(EVENTS.lessonCursor, 1, { cursor: 4 }),
      ev(EVENTS.lessonCursor, 2, {}),
    ]);
    expect(snap.cursor).toBe(4);
  });

  it("ignores a non-finite cursor (num guard) — keeps the prior value", () => {
    const snap = replay([
      ev(EVENTS.lessonCursor, 1, { cursor: 4 }),
      ev(EVENTS.lessonCursor, 2, { cursor: Infinity }),
      ev(EVENTS.lessonCursor, 3, { cursor: NaN }),
    ]);
    expect(snap.cursor).toBe(4);
  });
});

describe("replay — slotFilled", () => {
  it("records a full slot and registers its provider", () => {
    const snap = replay([
      ev(EVENTS.slotFilled, 1, { slot: 1, provider: "groq", rung: 2, ms: 150 }),
    ]);
    expect(snap.slots).toEqual([{ index: 1, state: "READY", provider: "groq", rung: 2, ms: 150 }]);
    expect(snap.providers).toEqual(["groq"]);
  });

  it("accepts slot index 0 (index !== undefined, not truthiness)", () => {
    const snap = replay([ev(EVENTS.slotFilled, 1, { slot: 0, provider: "ollama" })]);
    expect(snap.slots).toEqual([{ index: 0, state: "READY", provider: "ollama", rung: undefined, ms: undefined }]);
    expect(snap.providers).toEqual(["ollama"]);
  });

  it("skips a slotFilled with no slot index (num guard)", () => {
    const snap = replay([ev(EVENTS.slotFilled, 1, { provider: "groq" })]);
    expect(snap.slots).toEqual([]);
    expect(snap.providers).toEqual([]);
  });

  it("skips a slotFilled whose slot index is non-finite", () => {
    const snap = replay([ev(EVENTS.slotFilled, 1, { slot: NaN, provider: "groq" })]);
    expect(snap.slots).toEqual([]);
    expect(snap.providers).toEqual([]);
  });

  it("deduplicates providers but keeps every slot entry", () => {
    const snap = replay([
      ev(EVENTS.slotFilled, 1, { slot: 0, provider: "groq" }),
      ev(EVENTS.slotFilled, 2, { slot: 1, provider: "gemini" }),
      ev(EVENTS.slotFilled, 3, { slot: 2, provider: "groq" }), // repeat provider
    ]);
    expect(snap.providers).toEqual(["groq", "gemini"]); // first-seen order, deduped
    expect(snap.slots.map((s) => s.index)).toEqual([0, 1, 2]); // every slot kept
  });

  it("records a slot with no provider (provider undefined, not added to providers)", () => {
    const snap = replay([ev(EVENTS.slotFilled, 1, { slot: 3 })]);
    expect(snap.slots).toEqual([{ index: 3, state: "READY", provider: undefined, rung: undefined, ms: undefined }]);
    expect(snap.providers).toEqual([]);
  });
});

describe("replay — slotFailed", () => {
  it("records a failed slot with its rung and NO provider/ms keys", () => {
    const snap = replay([ev(EVENTS.slotFailed, 1, { slot: 2, rung: 3 })]);
    expect(snap.slots).toEqual([{ index: 2, state: "FAILED", rung: 3 }]);
    expect(snap.providers).toEqual([]);
  });

  it("accepts failed slot index 0", () => {
    const snap = replay([ev(EVENTS.slotFailed, 1, { slot: 0 })]);
    expect(snap.slots).toEqual([{ index: 0, state: "FAILED", rung: undefined }]);
  });

  it("skips a slotFailed with no slot index", () => {
    const snap = replay([ev(EVENTS.slotFailed, 1, { rung: 1 })]);
    expect(snap.slots).toEqual([]);
  });
});

describe("replay — lessonFinished outcome", () => {
  it("uses the provided outcome", () => {
    expect(replay([ev(EVENTS.lessonFinished, 1, { outcome: "PARTIAL" })]).outcome).toBe("PARTIAL");
  });

  it("defaults to COMPLETE when outcome is absent", () => {
    expect(replay([ev(EVENTS.lessonFinished, 1, {})]).outcome).toBe("COMPLETE");
  });

  it("defaults to COMPLETE when outcome is a non-string", () => {
    expect(replay([ev(EVENTS.lessonFinished, 1, { outcome: 7 })]).outcome).toBe("COMPLETE");
  });
});

describe("replay — lessonCancelled", () => {
  it("reports CANCELLED regardless of payload contents", () => {
    expect(replay([ev(EVENTS.lessonCancelled, 1, { outcome: "IGNORED" })]).outcome).toBe("CANCELLED");
  });
});

describe("replay — error collection", () => {
  it("collects error messages in seq order", () => {
    const snap = replay([
      ev(EVENTS.error, 2, { message: "second" }),
      ev(EVENTS.error, 1, { message: "first" }),
    ]);
    expect(snap.errors).toEqual(["first", "second"]);
  });

  it("skips an error event with no message", () => {
    const snap = replay([ev(EVENTS.error, 1, {})]);
    expect(snap.errors).toEqual([]);
  });

  it("skips an error event whose message is a non-string", () => {
    const snap = replay([ev(EVENTS.error, 1, { message: { nested: true } })]);
    expect(snap.errors).toEqual([]);
  });
});

describe("replay — payload record guard (rec)", () => {
  it("treats a null payload as an empty record (no fields extracted)", () => {
    const snap = replay([ev(EVENTS.requestReceived, 1, null)]);
    expect(snap.requestText).toBeNull();
  });

  it("treats a primitive (non-object) payload as an empty record", () => {
    const snap = replay([
      ev(EVENTS.requestReceived, 1, "not-an-object"),
      ev(EVENTS.lessonCursor, 2, 42),
    ]);
    expect(snap.requestText).toBeNull();
    expect(snap.cursor).toBe(0);
  });
});

describe("replay — unhandled event types (switch fall-through)", () => {
  it("ignores event types with no case and leaves the snapshot untouched", () => {
    const snap = replay([
      ev(EVENTS.providerUsed, 1, { provider: "groq" }),
      ev(EVENTS.blockEmitted, 2, { block: "text" }),
      ev(EVENTS.outlinePlanned, 3, { slots: 6 }),
    ]);
    // Only lessonId is picked up (from the guard); everything else stays default.
    expect(snap).toEqual({ ...empty, lessonId: "L1" });
  });
});

describe("replay — full lifecycle integration (out of order)", () => {
  it("reconstructs a complete lesson from shuffled rows", () => {
    const snap = replay([
      ev(EVENTS.lessonFinished, 8, { outcome: "COMPLETE" }),
      ev(EVENTS.slotFilled, 6, { slot: 0, provider: "groq", rung: 1, ms: 90 }),
      ev(EVENTS.requestReceived, 1, { text: "teach me vectors" }, null),
      ev(EVENTS.lessonState, 4, { to: "PLANNING" }),
      ev(EVENTS.commandSent, 2, { action: "StartLesson" }, null),
      ev(EVENTS.slotFailed, 7, { slot: 1, rung: 2 }),
      ev(EVENTS.lessonStarted, 3, { topic: "vectors" }),
      ev(EVENTS.lessonState, 5, { to: "TEACHING" }),
    ]);
    expect(snap).toEqual({
      lessonId: "L1",
      requestText: "teach me vectors",
      routing: "StartLesson",
      topic: "vectors",
      states: ["PLANNING", "TEACHING"],
      finalState: "TEACHING",
      cursor: 0,
      slots: [
        { index: 0, state: "READY", provider: "groq", rung: 1, ms: 90 },
        { index: 1, state: "FAILED", rung: 2 },
      ],
      providers: ["groq"],
      outcome: "COMPLETE",
      errors: [],
    });
  });
});
