import { describe, it, expect } from "vitest";
import { ingest, parse, process } from "@/server/ingest/pipeline";
import { normaliseText } from "@/server/ingest/normalise";

describe("ingest pipeline (§12) — pure, deterministic, span-preserving", () => {
  const raw = "Photosynthesis\n\n42\n\nPlants convert light energy into chemical energy.\n";

  // determinism (§12.3): identical bytes → identical chunk ids, on any machine.
  it("determinism — identical bytes produce identical chunk ids", () => {
    const a = ingest("src-1", raw, "markdown");
    const b = ingest("src-1", raw, "markdown");
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.length).toBeGreaterThan(0);
  });

  // re-ingestion is a diff (§12.3): one edited paragraph → new id, unchanged parts stable.
  it("re-ingestion is a diff — an edit changes exactly the chunks it touches", () => {
    const one = ingest("src-1", "Alpha para.\n\nBeta para.\n", "markdown", { chunk: { maxChars: 1 } });
    const two = ingest("src-1", "Alpha para.\n\nBeta EDITED.\n", "markdown", { chunk: { maxChars: 1 } });
    expect(two[0].id).toBe(one[0].id); // "Alpha para." unchanged → same id
    expect(two[1].id).not.toBe(one[1].id); // edited paragraph → new id
  });

  // a different sourceId yields different ids even for identical text (content-addressed by source).
  it("chunk id binds to the source — same text, different source, different id", () => {
    const a = ingest("src-1", raw, "markdown");
    const b = ingest("src-2", raw, "markdown");
    expect(a[0].id).not.toBe(b[0].id);
  });

  // span-preservation (§12.2): every surviving span's range maps back to the original text.
  it("span-preservation — a span's sourceRange slices back to its original text", () => {
    const doc = parse(raw, "markdown");
    for (const span of doc) {
      const [start, end] = span.sourceRange;
      expect(normaliseText(raw.slice(start, end))).toBe(normaliseText(span.text));
    }
  });

  // cleaning drops boilerplate (the "42" page number) while ranges still cover the original.
  it("cleaning removes boilerplate but the chunk range still maps to the source", () => {
    const chunks = process("src-1", parse(raw, "markdown"));
    const joined = chunks.map((c) => c.text).join(" ");
    expect(joined).toContain("Photosynthesis");
    expect(joined).toContain("Plants convert");
    expect(joined).not.toContain("42"); // page number dropped
    // the original still contains "42" inside the covered range — proof the range maps to source
    const [start, end] = chunks[0].locator.range;
    expect(raw.slice(start, end)).toContain("42");
  });

  it("html parses to visible-text spans with source ranges", () => {
    const html = "<h1>Title</h1><p>Body &amp; more.</p>";
    const doc = parse(html, "html");
    expect(doc.map((s) => s.text)).toEqual(["Title", "Body & more."]);
    expect(doc[0].sourceRange[0]).toBeLessThan(doc[1].sourceRange[0]);
  });
});
