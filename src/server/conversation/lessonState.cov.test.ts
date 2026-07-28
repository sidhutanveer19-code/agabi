import { describe, it, expect } from "vitest";
import {
  transition,
  isLessonState,
  type LessonState,
  type LessonEvent,
} from "@/server/conversation/lessonState";

const STATES: LessonState[] = [
  "IDLE",
  "PLANNING",
  "TEACHING",
  "WAITING_FOR_STUDENT",
  "SIMPLIFYING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
];

const EVENTS: LessonEvent[] = [
  "start",
  "planned",
  "chunkEmitted",
  "continue",
  "simplify",
  "simplified",
  "complete",
  "partial",
  "fail",
  "retry",
];

// The complete, authoritative legal-transition map. Every (from,event) NOT listed
// here is illegal and MUST throw. Mirrors TABLE in the source exactly.
const LEGAL: Record<LessonState, Partial<Record<LessonEvent, LessonState>>> = {
  IDLE: { start: "PLANNING" },
  PLANNING: { planned: "TEACHING" },
  TEACHING: {
    chunkEmitted: "WAITING_FOR_STUDENT",
    complete: "COMPLETED",
    partial: "PARTIAL",
    fail: "FAILED",
  },
  WAITING_FOR_STUDENT: {
    continue: "TEACHING",
    simplify: "SIMPLIFYING",
    complete: "COMPLETED",
    partial: "PARTIAL",
    fail: "FAILED",
  },
  SIMPLIFYING: { simplified: "WAITING_FOR_STUDENT" },
  COMPLETED: {},
  PARTIAL: { retry: "TEACHING" },
  FAILED: { retry: "TEACHING" },
};

describe("transition — exhaustive legal moves return the exact next state", () => {
  // Every cell that exists in the table must produce its exact target.
  for (const from of STATES) {
    for (const event of Object.keys(LEGAL[from]) as LessonEvent[]) {
      const expected = LEGAL[from][event]!;
      it(`${from} --${event}--> ${expected}`, () => {
        expect(transition(from, event)).toBe(expected);
      });
    }
  }

  it("returns a value (never undefined) for every legal move", () => {
    for (const from of STATES) {
      for (const event of Object.keys(LEGAL[from]) as LessonEvent[]) {
        const result = transition(from, event);
        expect(result).toBeTypeOf("string");
        expect(STATES).toContain(result);
      }
    }
  });
});

describe("transition — every move NOT in the table throws the guard error", () => {
  // Drive EVERY (state,event) pair: legal ones return, illegal ones throw.
  for (const from of STATES) {
    for (const event of EVENTS) {
      const isLegal = event in LEGAL[from];
      if (isLegal) continue;
      it(`${from} --${event}--> throws`, () => {
        expect(() => transition(from, event)).toThrow();
      });
    }
  }

  it("all three terminal states with no outgoing edges reject every event", () => {
    // COMPLETED has zero edges; PARTIAL/FAILED accept only retry.
    for (const event of EVENTS) {
      expect(() => transition("COMPLETED", event)).toThrow();
    }
    for (const event of EVENTS) {
      if (event === "retry") continue;
      expect(() => transition("PARTIAL", event)).toThrow();
      expect(() => transition("FAILED", event)).toThrow();
    }
  });

  it("throws the exact guard message embedding both from and event", () => {
    expect(() => transition("IDLE", "continue")).toThrow(
      "Illegal lesson transition: IDLE --continue-->",
    );
    expect(() => transition("COMPLETED", "retry")).toThrow(
      "Illegal lesson transition: COMPLETED --retry-->",
    );
    expect(() => transition("TEACHING", "simplify")).toThrow(
      "Illegal lesson transition: TEACHING --simplify-->",
    );
  });

  it("throws an actual Error instance", () => {
    expect(() => transition("SIMPLIFYING", "start")).toThrow(Error);
  });
});

describe("transition — specific edge cases the state machine hinges on", () => {
  it("retry re-opens PARTIAL and FAILED back into TEACHING", () => {
    expect(transition("PARTIAL", "retry")).toBe("TEACHING");
    expect(transition("FAILED", "retry")).toBe("TEACHING");
  });

  it("COMPLETED never retries (no FAILED blocks to regenerate)", () => {
    expect(() => transition("COMPLETED", "retry")).toThrow();
  });

  it("TEACHING can end in any of COMPLETED, PARTIAL, or FAILED", () => {
    expect(transition("TEACHING", "complete")).toBe("COMPLETED");
    expect(transition("TEACHING", "partial")).toBe("PARTIAL");
    expect(transition("TEACHING", "fail")).toBe("FAILED");
  });

  it("WAITING_FOR_STUDENT can loop, simplify, or terminate", () => {
    expect(transition("WAITING_FOR_STUDENT", "continue")).toBe("TEACHING");
    expect(transition("WAITING_FOR_STUDENT", "simplify")).toBe("SIMPLIFYING");
    expect(transition("WAITING_FOR_STUDENT", "complete")).toBe("COMPLETED");
    expect(transition("WAITING_FOR_STUDENT", "partial")).toBe("PARTIAL");
    expect(transition("WAITING_FOR_STUDENT", "fail")).toBe("FAILED");
  });

  it("SIMPLIFYING returns only to WAITING_FOR_STUDENT", () => {
    expect(transition("SIMPLIFYING", "simplified")).toBe("WAITING_FOR_STUDENT");
    expect(() => transition("SIMPLIFYING", "continue")).toThrow();
  });

  it("TEACHING cannot itself be reached by chunkEmitted twice without WAITING", () => {
    // chunkEmitted is only valid out of TEACHING, not out of WAITING_FOR_STUDENT.
    expect(transition("TEACHING", "chunkEmitted")).toBe("WAITING_FOR_STUDENT");
    expect(() => transition("WAITING_FOR_STUDENT", "chunkEmitted")).toThrow();
  });
});

describe("isLessonState — narrows exactly the eight canonical states", () => {
  it("returns true for every canonical LessonState", () => {
    for (const s of STATES) {
      expect(isLessonState(s)).toBe(true);
    }
  });

  it("returns true for each state individually (kills per-element removal)", () => {
    expect(isLessonState("IDLE")).toBe(true);
    expect(isLessonState("PLANNING")).toBe(true);
    expect(isLessonState("TEACHING")).toBe(true);
    expect(isLessonState("WAITING_FOR_STUDENT")).toBe(true);
    expect(isLessonState("SIMPLIFYING")).toBe(true);
    expect(isLessonState("COMPLETED")).toBe(true);
    expect(isLessonState("PARTIAL")).toBe(true);
    expect(isLessonState("FAILED")).toBe(true);
  });

  it("returns false for the empty string", () => {
    expect(isLessonState("")).toBe(false);
  });

  it("is case-sensitive (lowercased states are not valid)", () => {
    expect(isLessonState("idle")).toBe(false);
    expect(isLessonState("teaching")).toBe(false);
    expect(isLessonState("Completed")).toBe(false);
  });

  it("returns false for near-misses, events, and arbitrary junk", () => {
    expect(isLessonState("TEACH")).toBe(false);
    expect(isLessonState("WAITING")).toBe(false);
    expect(isLessonState("WAITING_FOR_STUDENTS")).toBe(false);
    expect(isLessonState("start")).toBe(false); // an event, not a state
    expect(isLessonState("retry")).toBe(false);
    expect(isLessonState("DONE")).toBe(false);
    expect(isLessonState(" IDLE")).toBe(false); // leading whitespace
    expect(isLessonState("IDLE ")).toBe(false); // trailing whitespace
  });

  it("no LessonEvent name is mistaken for a LessonState", () => {
    for (const event of EVENTS) {
      expect(isLessonState(event)).toBe(false);
    }
  });
});
