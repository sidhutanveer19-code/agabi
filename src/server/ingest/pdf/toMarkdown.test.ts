import { describe, it, expect } from "vitest";
import { pdfTextToMarkdown } from "@/server/ingest/pdf/toMarkdown";

const NCERT = [
  "INTRODUCTION TO TRIGONOMETRY",
  "113",
  "8.1 Introduction",
  "You have already studied about triangles.",
  "Right triangles can be imagined.",
  "",
  "8.2 Trigonometric Ratios",
  "MATHEMATICS 114",
  "The ratios of sides of a right triangle.",
  "8.2.1 Values",
  "Specific values exist.",
].join("\n");

describe("pdf→markdown normalizer (A-4)", () => {
  it("reconstructs headings from NCERT numbering + drops page/header noise (NDND-reported)", () => {
    const r = pdfTextToMarkdown(NCERT);
    expect(r.markdown).toContain("# INTRODUCTION TO TRIGONOMETRY");
    expect(r.markdown).toContain("## 8.1 Introduction");
    expect(r.markdown).toContain("## 8.2 Trigonometric Ratios");
    expect(r.markdown).toContain("### 8.2.1 Values");
    expect(r.markdown).toContain("You have already studied about triangles."); // body preserved
    expect(r.markdown).not.toMatch(/^113$/m); // standalone page number dropped
    expect(r.markdown).not.toContain("MATHEMATICS 114"); // running header dropped
    expect(r.droppedNoiseLines).toBeGreaterThanOrEqual(2);
    expect(r.headings).toBe(3);
  });

  it("uses an explicit chapter title when provided", () => {
    expect(pdfTextToMarkdown("8.1 A\nbody text.", "My Chapter").markdown.startsWith("# My Chapter")).toBe(true);
  });

  it("empty text → empty-ish markdown, no throw", () => {
    expect(pdfTextToMarkdown("").markdown.trim()).toBe("");
  });
});
