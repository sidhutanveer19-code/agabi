import { describe, it, expect } from "vitest";
import { replay, type ReplayEvent } from "@/server/evidence/replay";
import { EVENTS } from "@/server/events";

const L = "lesson_1";
// Deliberately OUT OF ORDER by input position — replay must sort by `seq` alone.
const rows: ReplayEvent[] = [
  { type: EVENTS.slotFilled, seq: BigInt(6), lessonId: L, payload: { slot: 1, provider: "groq", rung: 1 } },
  { type: EVENTS.requestReceived, seq: BigInt(1), lessonId: null, payload: { text: "teach me quadratics", kind: "lesson" } },
  { type: EVENTS.lessonFinished, seq: BigInt(8), lessonId: L, payload: { outcome: "PARTIAL" } },
  { type: EVENTS.commandSent, seq: BigInt(2), lessonId: L, payload: { action: "StartLesson" } },
  { type: EVENTS.lessonStarted, seq: BigInt(3), lessonId: L, payload: { topic: "quadratics", requestText: "teach me quadratics" } },
  { type: EVENTS.lessonState, seq: BigInt(4), lessonId: L, payload: { from: "IDLE", to: "PLANNING" } },
  { type: EVENTS.lessonState, seq: BigInt(5), lessonId: L, payload: { from: "PLANNING", to: "TEACHING" } },
  { type: EVENTS.slotFailed, seq: BigInt(7), lessonId: L, payload: { slot: 2, slotType: "timeline" } },
];

describe("replay — reconstruct a lesson from Event rows alone", () => {
  it("rebuilds request, routing, states, slots, providers, outcome (ordered by seq)", () => {
    const snap = replay(rows);
    expect(snap.lessonId).toBe(L);
    expect(snap.requestText).toBe("teach me quadratics");
    expect(snap.routing).toBe("StartLesson");
    expect(snap.topic).toBe("quadratics");
    expect(snap.states).toEqual(["PLANNING", "TEACHING"]);
    expect(snap.finalState).toBe("TEACHING");
    expect(snap.providers).toEqual(["groq"]);
    expect(snap.slots).toEqual([
      { index: 1, state: "READY", provider: "groq", rung: 1, ms: undefined },
      { index: 2, state: "FAILED", rung: undefined },
    ]);
    expect(snap.outcome).toBe("PARTIAL");
  });

  it("accepts seq as string (JSON) and still orders correctly", () => {
    const jsonish = rows.map((r) => ({ ...r, seq: String(r.seq) }));
    expect(replay(jsonish).states).toEqual(["PLANNING", "TEACHING"]);
  });

  it("a cancelled lesson reports CANCELLED", () => {
    const snap = replay([{ type: EVENTS.lessonCancelled, seq: BigInt(1), lessonId: L, payload: {} }]);
    expect(snap.outcome).toBe("CANCELLED");
  });
});
