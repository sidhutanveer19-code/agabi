import { describe, it, expect } from "vitest";
import { teachingAngle, ANGLES } from "@/server/conversation/adaptivity";

/**
 * Adaptivity (Step 6): explaining the SAME topic again must come from a DIFFERENT angle, so
 * Diversity = 1 − similarity(prev, current) stays above threshold. teachingAngle is the pure
 * rotation that drives it — attempt 0 is the default lesson (no forced angle); each re-ask after
 * that gets a distinct framing. This test pins the rotation so a "same output every time" mutant dies.
 */
describe("teachingAngle — a different lens on each re-ask", () => {
  it("attempt 0 (the first teaching) forces NO angle — default lesson", () => {
    expect(teachingAngle(0)).toBe("");
    expect(teachingAngle(-3)).toBe(""); // guard: never negative-indexes
  });

  it("consecutive re-asks get DIFFERENT angles (drives Diversity up)", () => {
    expect(teachingAngle(1)).not.toBe(teachingAngle(2));
    expect(teachingAngle(2)).not.toBe(teachingAngle(3));
    expect(teachingAngle(1)).not.toBe("");
  });

  it("every angle in the rotation is non-empty and distinct (no accidental repeats)", () => {
    expect(ANGLES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ANGLES).size).toBe(ANGLES.length);
    for (const a of ANGLES) expect(a.trim().length).toBeGreaterThan(0);
  });

  it("the rotation wraps deterministically (attempt n uses ANGLES[(n-1) % len])", () => {
    expect(teachingAngle(1)).toBe(ANGLES[0]);
    expect(teachingAngle(ANGLES.length)).toBe(ANGLES[ANGLES.length - 1]);
    expect(teachingAngle(ANGLES.length + 1)).toBe(ANGLES[0]); // wrapped
  });
});
