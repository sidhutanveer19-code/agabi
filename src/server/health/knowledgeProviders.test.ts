import { describe, it, expect } from "vitest";
import "@/server/health/index"; // registers every provider (side effect)
import { providers } from "@/server/health/registry";

describe("§28 knowledge health providers", () => {
  it("registers the five knowledge providers", () => {
    const names = new Set(providers().map((p) => p.name));
    for (const n of ["knowledge-store", "knowledge-integrity", "trust-pipeline", "ingestion", "observation-store"]) {
      expect(names.has(n), `missing provider ${n}`).toBe(true);
    }
  });

  it("the DB-free providers report honestly, never fake-green", async () => {
    const byName = new Map(providers().map((p) => [p.name, p]));
    // ingestion + observation-store touch no DB — they must declare NOT_INSTALLED, not UP.
    expect((await byName.get("ingestion")!.check()).status).toBe("NOT_INSTALLED");
    expect((await byName.get("observation-store")!.check()).status).toBe("NOT_INSTALLED");
  });
});
