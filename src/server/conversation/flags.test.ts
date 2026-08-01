import { describe, it, expect, afterEach } from "vitest";
import { sourceGroundingEnabled } from "@/server/conversation/flags";

/**
 * The rollout flag must be OFF unless explicitly "1" — a loose truthy check would turn the whole
 * grounded path on for SOURCE_GROUNDING="0" or ="false" (a silent, dangerous default flip). This
 * pins the exact "=== '1'" contract so that mutant dies.
 */
const prev = process.env.SOURCE_GROUNDING;
afterEach(() => {
  if (prev === undefined) delete process.env.SOURCE_GROUNDING;
  else process.env.SOURCE_GROUNDING = prev;
});

describe("sourceGroundingEnabled — off unless exactly '1'", () => {
  it("unset → false (today's behaviour is the default)", () => {
    delete process.env.SOURCE_GROUNDING;
    expect(sourceGroundingEnabled()).toBe(false);
  });
  it("'1' → true", () => {
    process.env.SOURCE_GROUNDING = "1";
    expect(sourceGroundingEnabled()).toBe(true);
  });
  it("'0' and 'true' → false (no loose truthiness)", () => {
    process.env.SOURCE_GROUNDING = "0";
    expect(sourceGroundingEnabled()).toBe(false);
    process.env.SOURCE_GROUNDING = "true";
    expect(sourceGroundingEnabled()).toBe(false);
  });
});
