import { describe, it, expect } from "vitest";
import { teachingStyle } from "@/server/conversation/prompt";
import type { TeachingPrefs } from "@contract/schemas";

/**
 * Step 7 onboarding SEAM: `teachingStyle(prefs?)` accepts how-you-want-to-be-taught prefs,
 * but with NO prefs it must be BYTE-IDENTICAL to today (the seam is plumbed, not populated).
 * A behaviour change here would silently alter every lesson — this test is the guard.
 */
describe("teachingStyle — onboarding prefs seam (inert when unset)", () => {
  it("no prefs === undefined === empty object → identical default (zero behaviour change)", () => {
    const base = teachingStyle();
    expect(teachingStyle(undefined)).toBe(base);
    expect(teachingStyle({})).toBe(base);
    expect(base).not.toMatch(/student prefers/i); // no prefs line leaks into the default
  });

  it("given prefs → they are appended (and correctness framing preserved)", () => {
    const prefs: TeachingPrefs = { tone: "encouraging", interests: "cricket" };
    const out = teachingStyle(prefs);
    expect(out.length).toBeGreaterThan(teachingStyle().length);
    expect(out).toMatch(/encouraging/);
    expect(out).toMatch(/cricket/);
    expect(out.startsWith(teachingStyle())).toBe(true); // default soul stays first, prefs added after
  });

  it("a prefs object with only empty/whitespace fields stays identical to default", () => {
    expect(teachingStyle({ tone: "   ", depth: "" })).toBe(teachingStyle());
  });
});
