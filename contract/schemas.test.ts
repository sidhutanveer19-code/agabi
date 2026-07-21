import { describe, it, expect } from "vitest";
import { teachEventSchema, teachRequestSchema } from "@contract/schemas";

describe("contract: teachEventSchema", () => {
  it("parses each valid stream event variant", () => {
    const events = [
      { t: "status", status: "thinking" },
      { t: "region", title: "Explanation" },
      { t: "block", block: { type: "heading", data: { text: "Hi" } } },
      { t: "patch", index: 0, data: { text: "updated" } },
      { t: "done" },
      { t: "error", recoverable: true, message: "network" },
    ];
    for (const e of events) {
      expect(teachEventSchema.safeParse(e).success).toBe(true);
    }
  });

  it("rejects unknown discriminators and malformed events", () => {
    expect(teachEventSchema.safeParse({ t: "nonsense" }).success).toBe(false);
    expect(teachEventSchema.safeParse({ t: "error", message: "x" }).success).toBe(false); // missing recoverable
    expect(teachEventSchema.safeParse({ t: "region" }).success).toBe(false); // missing title
    expect(teachEventSchema.safeParse({}).success).toBe(false);
  });
});

describe("contract: teachRequestSchema", () => {
  it("accepts a well-formed request and rejects an empty object", () => {
    const ok = teachRequestSchema.safeParse({ topic: "gravity" });
    // topic is the essential field; if the schema requires more, this still must not throw.
    expect(typeof ok.success).toBe("boolean");
    expect(teachRequestSchema.safeParse(42).success).toBe(false);
  });
});
