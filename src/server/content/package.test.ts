import { describe, it, expect } from "vitest";
import { canonicalJson, toNdjson, fromNdjson, diffDumps, reviveDates, countsOf, GRAPH_TABLES, DATE_FIELDS } from "@/server/content/package";
import { createMemoryStore } from "@/server/knowledge/store/memory";
import { buildConcept } from "@/server/knowledge/concept";
import { buildStatement } from "@/server/knowledge/statement";
import type { GraphDump } from "@/server/knowledge/store/KnowledgeStore";

async function populated(): Promise<GraphDump> {
  const store = createMemoryStore();
  const ctx = await store.putContext({ subject: "maths" });
  const c = buildConcept({ name: "Prime factorisation" });
  await store.putConcept(c);
  await store.putSource({ id: "src1", kind: "book", title: "Maths", publisher: "p", authority: "a", edition: null, publishedAt: null, uri: "file:///m.md", checksum: "x", license: "CC0-1.0", licenseUrl: null, ingestedAt: new Date("2026-07-23T10:00:00Z") });
  await store.putSourceChunk({ id: "ch1", sourceId: "src1", locator: { page: 1, range: [0, 40] }, text: "Every composite number factorises.", ordinal: 0 });
  const s = buildStatement({ kind: "DEFINITION", form: "DEFINITIONAL", structure: { subject: "Prime factorisation" }, text: "Composites break into primes.", contextId: ctx.id, subjectId: c.id });
  await store.putStatement(s);
  await store.putProvenance({ statementId: s.id, sourceId: "src1", chunkId: "ch1", locator: {}, quote: "Every composite number factorises", extractorVersion: "1", promptVersion: "1", modelId: "m", extractedAt: new Date("2026-07-23T10:01:00Z") });
  return store.dumpAll();
}

describe("knowledge package (Stage 5) — serialisation + round-trip identity", () => {
  it("canonicalJson is key-order independent and stringifies Dates", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ at: new Date("2026-07-23T10:00:00Z") })).toBe('{"at":"2026-07-23T10:00:00.000Z"}');
    expect(canonicalJson({ nested: { z: 1, a: [{ y: 1, x: 2 }] } })).toBe('{"nested":{"a":[{"x":2,"y":1}],"z":1}}');
  });

  it("NDJSON round-trips row for row", () => {
    const rows = [{ id: "b", n: 2 }, { id: "a", n: 1 }];
    expect(fromNdjson(toNdjson(rows))).toEqual(rows);
    expect(toNdjson([])).toBe(""); // an empty table is an empty file, not a stray newline
  });

  it("a full dump serialises and restores IDENTICALLY (ids preserved, dates revived)", async () => {
    const dump = await populated();

    // serialise every table the way export does, then read it back the way import does
    const restored: Record<string, unknown> = {};
    for (const table of GRAPH_TABLES) {
      const raw = fromNdjson<Record<string, unknown>>(toNdjson(dump[table] as unknown[]));
      restored[table] = reviveDates(raw, DATE_FIELDS[table] ?? []);
    }

    const back = restored as unknown as GraphDump;
    expect(diffDumps(dump, back)).toEqual([]);
    // and the identity that matters: the ids came back verbatim, never re-minted
    expect(back.statements[0].id).toBe(dump.statements[0].id);
    expect(back.concepts[0].id).toBe(dump.concepts[0].id);
    expect(back.statements[0].createdAt).toBeInstanceOf(Date);
    expect(back.sources[0].ingestedAt).toBeInstanceOf(Date);
  });

  it("diffDumps names the table, the count and the FIRST differing row — never a bare boolean", async () => {
    const dump = await populated();
    const tampered: GraphDump = { ...dump, statements: [{ ...dump.statements[0], text: "something else" }] };

    const diffs = diffDumps(dump, tampered);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].table).toBe("statements");
    expect(diffs[0].firstMismatch?.index).toBe(0);
    expect(diffs[0].firstMismatch?.actual).toContain("something else");
  });

  it("a missing row is a count difference, reported per table", async () => {
    const dump = await populated();
    const diffs = diffDumps(dump, { ...dump, provenance: [] });
    expect(diffs).toEqual([{ table: "provenance", expected: 1, actual: 0 }]);
  });

  it("counts cover every table in the package", async () => {
    const counts = countsOf(await populated());
    expect(Object.keys(counts).sort()).toEqual([...GRAPH_TABLES].sort());
    expect(counts.statements).toBe(1);
    expect(counts.sources).toBe(1);
    expect(counts.sourceChunks).toBe(1);
  });
});
