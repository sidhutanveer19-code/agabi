import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/server/events", async (orig) => {
  const actual = await orig<typeof import("@/server/events")>();
  return { ...actual, emit: vi.fn(async () => "evt"), emitMany: vi.fn(async () => []) };
});

import { loadDataset, DatasetManifestSchema } from "@/server/content/dataset";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

const fixture = {
  entities: [{ name: "Cell" }, { name: "Membrane" }],
  statements: [{ form: "SPO", kind: "FACT", text: "A cell is bounded by a membrane.", quote: "A cell is bounded by a membrane", structure: {}, subject: "Cell", predicate: "bounded-by", object: "Membrane" }],
  dependencies: [],
  assets: [],
  items: [],
};
const fakeInvoke: JsonInvoke = async () => ({ raw: JSON.stringify(fixture), data: fixture });
const SAMPLE = join(process.cwd(), "datasets", "sample-science");
const TMP = join(process.env.CLAUDE_JOB_DIR ?? "/tmp", "tmp");

describe("dataset framework (W5) — a curriculum is DATA, not code", () => {
  it("validates + installs the committed sample package through the pipeline", async () => {
    const r = await loadDataset(SAMPLE, createMemoryStore(), fakeInvoke, { modelId: "fake" });
    expect(r.id).toBe("sample-science");
    expect(r.profile).toBe("generic");
    expect(r.sources).toBe(1);
    // discovery read the REAL markdown structure of the committed chapter
    const top = r.results[0].hierarchy.nodes[0];
    expect(top.title).toBe("The Cell");
    expect(top.children.map((c) => c.title)).toEqual(["Cell Structure", "Cell Function"]);
    // proposals persisted (fake extractor), MACHINE_PROPOSED
    expect(r.counts.concepts).toBeGreaterThanOrEqual(1);
    expect(r.counts.statements).toBeGreaterThanOrEqual(1);
  });

  it("rejects a manifest that violates the contract", () => {
    expect(() => DatasetManifestSchema.parse({ id: "x" })).toThrow();
    expect(() => DatasetManifestSchema.parse({ id: "x", name: "x", license: "CC0", version: "1", sources: [] })).toThrow(); // sources min 1
  });

  it("adding a NEW curriculum is a new package dir — ZERO engine change", async () => {
    const dir = join(TMP, "ds-new-curriculum");
    mkdirSync(join(dir, "ch"), { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id: "new-curric", name: "New", profile: "generic", license: "CC0-1.0", version: "1.0.0", sources: [{ ref: "ch/intro.md", format: "markdown" }] }));
    writeFileSync(join(dir, "ch", "intro.md"), "# Intro\n\nA topic sentence about atoms.\n");
    const r = await loadDataset(dir, createMemoryStore(), fakeInvoke, { modelId: "fake" });
    expect(r.id).toBe("new-curric");
    expect(r.results[0].hierarchy.nodes[0].title).toBe("Intro");
  });
});
