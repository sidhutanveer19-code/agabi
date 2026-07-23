import { describe, it, expect } from "vitest";
import { pdfTextToMarkdown, collapseRepeats } from "@/server/ingest/pdf/toMarkdown";

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

  // ── Stage 1: real-world shapes the first pass let through ──

  it("drops number-then-CAPS left-page headers and '-- N of M --' page markers", () => {
    const src = ["9.1 Light", "188 MATHEMATICS", "-- 3 of 9 --", "A ray travels in a straight line.", "2 MATHEMATICS"].join("\n");
    const r = pdfTextToMarkdown(src);
    expect(r.markdown).not.toContain("188 MATHEMATICS");
    expect(r.markdown).not.toContain("2 MATHEMATICS");
    expect(r.markdown).not.toContain("-- 3 of 9 --");
    expect(r.markdown).toContain("A ray travels in a straight line."); // body preserved
    expect(r.drops.map((d) => d.rule).sort()).toEqual(["page-marker", "running-header", "running-header"]);
  });

  it("records EVERY drop with line number, rule and text (R1 — never silently skip)", () => {
    const r = pdfTextToMarkdown(["body one.", "-- 1 of 2 --", "113"].join("\n"));
    expect(r.drops).toEqual([
      { line: 2, rule: "page-marker", text: "-- 1 of 2 --" },
      { line: 3, rule: "page-number", text: "113" },
    ]);
    expect(r.droppedNoiseLines).toBe(r.drops.length);
  });

  it("collapses faux-bold repetition and records the repair", () => {
    const src = "NOTES FOR THE TEACHER NOTES FOR THE TEACHER NOTES FOR THE TEACHER Most regions are interconnected.";
    const r = pdfTextToMarkdown(src);
    expect(r.markdown).toContain("NOTES FOR THE TEACHER Most regions are interconnected.");
    expect(r.markdown).not.toContain("TEACHER NOTES FOR THE TEACHER");
    expect(r.repairs).toHaveLength(1);
    expect(r.repairs[0]).toMatchObject({ line: 1, rule: "faux-bold-repeat" });
    expect(r.repairs[0].before).toBe(src);
  });

  it("collapseRepeats never touches numeric runs or short words", () => {
    expect(collapseRepeats("0 0 0 0")).toBe("0 0 0 0");
    expect(collapseRepeats("a a a")).toBe("a a a");
    expect(collapseRepeats("UNDERST UNDERST UNDERST UNDERSTANDING")).toBe("UNDERST UNDERSTANDING");
    expect(collapseRepeats("the cat sat on the mat")).toBe("the cat sat on the mat");
  });
});
