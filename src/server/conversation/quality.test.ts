import { describe, it, expect } from "vitest";
import { scoreLesson } from "@/server/conversation/quality";
import { normalizeSlot } from "@/server/conversation/lessonRepo";
import type { OutlineSlot } from "@/server/conversation/outline";

describe("scoreLesson (derived on read)", () => {
  it("all READY → COMPLETE", () => {
    const r = scoreLesson([{ state: "READY" }, { state: "READY" }, { state: "READY" }]);
    expect(r.outcome).toBe("COMPLETE");
    expect(r.readyCount).toBe(3);
    expect(r.failedIndices).toEqual([]);
  });
  it("some FAILED → PARTIAL with the failed slot numbers", () => {
    const r = scoreLesson([{ slot: 1, state: "READY" }, { slot: 2, state: "FAILED" }, { slot: 3, state: "READY" }]);
    expect(r.outcome).toBe("PARTIAL");
    expect(r.failedIndices).toEqual([2]);
  });
  it("zero READY (all-skeleton) → FAILED", () => {
    expect(scoreLesson([{ state: "FAILED" }, { state: "FAILED" }]).outcome).toBe("FAILED");
  });
  it("no slots → FAILED", () => {
    expect(scoreLesson([]).outcome).toBe("FAILED");
  });
});

describe("FIX 3 — pre-Stage-B rows read as READY, never fabricated-degraded", () => {
  it("a slot with NO state normalizes to READY and scores COMPLETE", () => {
    const preStageB: (OutlineSlot & { state?: string })[] = [
      { slot: 1, type: "heading", intent: "x" },
      { slot: 2, type: "paragraph", intent: "y" },
      { slot: 3, type: "summary", intent: "z" },
    ];
    const normalized = preStageB.map(normalizeSlot);
    expect(normalized.every((s) => s.state === "READY")).toBe(true);
    expect(scoreLesson(normalized).outcome).toBe("COMPLETE");
  });
  it("an unknown/garbage state also falls back to READY (not FAILED)", () => {
    expect(normalizeSlot({ slot: 1, type: "x", intent: "y", state: "BOGUS" }).state).toBe("READY");
  });
});
