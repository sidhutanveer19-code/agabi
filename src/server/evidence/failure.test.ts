import { describe, it, expect } from "vitest";
import { classify } from "@/server/evidence/failure";

describe("failure.classify", () => {
  it("DB unreachable/timeout/pool codes are transient (retrying is right)", () => {
    for (const code of ["P1001", "P1002", "P1008", "P2024"]) {
      expect(classify({ code })).toBe("transient");
      expect(classify({ errorCode: code })).toBe("transient");
    }
  });

  it("too-long/invalid/validation codes are permanent (retrying is futile)", () => {
    for (const code of ["P2000", "P2006", "P2007"]) expect(classify({ code })).toBe("permanent");
  });

  it("BigInt / circular-JSON TypeError|RangeError are permanent (deterministic)", () => {
    expect(classify(new TypeError("Do not know how to serialize a BigInt"))).toBe("permanent");
    expect(classify(new RangeError("x"))).toBe("permanent");
  });

  it("unknown failure defaults to transient (the Outbox absorbs it)", () => {
    expect(classify(new Error("who knows"))).toBe("transient");
    expect(classify({ code: "P9999" })).toBe("transient");
  });
});
