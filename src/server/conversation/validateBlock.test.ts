import { describe, it, expect } from "vitest";
import { adaptBlock } from "@/server/conversation/validateBlock";

const str = (v: unknown) => JSON.stringify(v);

describe("adaptBlock — the validate/adapt ladder [I1]", () => {
  it("wraps text-family into a ProseMirror doc", () => {
    const r = adaptBlock("paragraph", { text: "hello world" });
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("paragraph");
    expect(str(r.data)).toContain('"paragraph"');
    expect(str(r.data)).toContain("hello world");
  });

  it("heading uses a heading node; falls back to streamText for the text", () => {
    const r = adaptBlock("heading", {}, "Photosynthesis");
    expect(r.fallback).toBe(false);
    expect(str(r.data)).toContain('"heading"');
    expect(str(r.data)).toContain("Photosynthesis");
  });

  it("valid chart passes through", () => {
    const r = adaptBlock("chart", { kind: "bar", series: [{ key: "value" }], data: [{ label: "A", value: 3 }] });
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("chart");
  });

  it("malformed chart → minimal VISUAL (mindmap), never a paragraph", () => {
    const r = adaptBlock("chart", { nonsense: true }, "charts show the trend");
    expect(r.fallback).toBe(true);
    expect(r.type).toBe("mindmap"); // a visual slot must never collapse to prose
    expect(r.type).not.toBe("paragraph");
    expect(str(r.data)).toContain("charts show the trend");
  });

  it("valid math passes; empty math substitutes", () => {
    expect(adaptBlock("formula", { latex: "a^2 + b^2 = c^2" }).fallback).toBe(false);
    expect(adaptBlock("formula", {}).fallback).toBe(true);
  });

  it("list gets item ids and validates", () => {
    const r = adaptBlock("bullet", { items: [{ text: "one" }, { text: "two" }] });
    expect(r.fallback).toBe(false);
    expect(str(r.data)).toMatch(/"id":"it_/);
  });

  it("table coerces cells and defaults colWidths", () => {
    const r = adaptBlock("table", { headers: ["A", "B"], rows: [["1", "2"]] });
    expect(r.fallback).toBe(false);
    expect(str(r.data)).toContain("colWidths");
  });

  it("unknown/visual type emitted as-is (BlockErrorBoundary contains throws)", () => {
    const r = adaptBlock("mermaid", { source: "graph TD; A-->B" });
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("mermaid");
    expect(str(r.data)).toContain("graph TD");
  });

  it("mermaid with no source substitutes", () => {
    expect(adaptBlock("mermaid", {}, "a flow of A to B").fallback).toBe(true);
  });

  it("V2: malformed mermaid + molecule → minimal VISUAL (mindmap), never a paragraph", () => {
    const m = adaptBlock("mermaid", { garbage: 1 }, "diagram of the cycle");
    expect(m.fallback).toBe(true);
    expect(m.type).toBe("mindmap");
    expect(m.type).not.toBe("paragraph");

    const mol = adaptBlock("molecule", {}, "the water molecule H2O");
    expect(mol.fallback).toBe(true);
    expect(mol.type).toBe("mindmap");
    expect(mol.type).not.toBe("paragraph");
    expect(str(mol.data)).toContain("water molecule");
  });
});
