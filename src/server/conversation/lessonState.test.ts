import { describe, it, expect } from "vitest";
import { transition } from "@/server/conversation/lessonState";

describe("lesson state machine — the table, and it rejects illegal moves", () => {
  it("accepts every legal transition", () => {
    expect(transition("IDLE", "start")).toBe("PLANNING");
    expect(transition("PLANNING", "planned")).toBe("TEACHING");
    expect(transition("TEACHING", "chunkEmitted")).toBe("WAITING_FOR_STUDENT");
    expect(transition("TEACHING", "complete")).toBe("COMPLETED");
    expect(transition("WAITING_FOR_STUDENT", "continue")).toBe("TEACHING");
    expect(transition("WAITING_FOR_STUDENT", "simplify")).toBe("SIMPLIFYING");
    expect(transition("WAITING_FOR_STUDENT", "complete")).toBe("COMPLETED");
    expect(transition("SIMPLIFYING", "simplified")).toBe("WAITING_FOR_STUDENT");
    expect(transition("TEACHING", "partial")).toBe("PARTIAL");
    expect(transition("TEACHING", "fail")).toBe("FAILED");
    // retry re-opens a degraded lesson to regenerate its FAILED blocks
    expect(transition("PARTIAL", "retry")).toBe("TEACHING");
    expect(transition("FAILED", "retry")).toBe("TEACHING");
  });

  it("throws on every illegal move (a model can never drive this)", () => {
    expect(() => transition("IDLE", "continue")).toThrow();
    expect(() => transition("IDLE", "complete")).toThrow();
    expect(() => transition("PLANNING", "continue")).toThrow();
    expect(() => transition("TEACHING", "simplify")).toThrow();
    expect(() => transition("WAITING_FOR_STUDENT", "start")).toThrow();
    expect(() => transition("SIMPLIFYING", "continue")).toThrow();
    expect(() => transition("COMPLETED", "start")).toThrow();
    expect(() => transition("COMPLETED", "continue")).toThrow();
    expect(() => transition("COMPLETED", "retry")).toThrow(); // COMPLETE has no FAILED slots to retry
    expect(() => transition("TEACHING", "retry")).toThrow();
  });
});
