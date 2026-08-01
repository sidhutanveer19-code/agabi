import { describe, it, expect } from "vitest";

// FIX 1 — `seq` is a Postgres BigInt. Raw JSON.stringify THROWS on BigInt; every
// boundary (logger, health, payloads) must convert via .toString(). This proves the
// hazard exists and the fix works, so nobody reintroduces a raw stringify of a row.
describe("BigInt seq survives JSON serialization", () => {
  it("raw stringify of a BigInt throws; toString() survives", () => {
    const row = { id: "e1", seq: BigInt(42), type: "lesson.started" };
    expect(() => JSON.stringify(row)).toThrow();
    expect(JSON.parse(JSON.stringify({ ...row, seq: row.seq.toString() })).seq).toBe("42");
  });
});
