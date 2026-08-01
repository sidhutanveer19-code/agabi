import { describe, it, expect } from "vitest";
import { coerceSlot, hasMeaningfulPayload } from "@/server/conversation/coerce";

/**
 * MUTATION KILLERS for coerce.ts — each test pins the EXACT observable behavior a
 * surviving Stryker mutant changes. Pure logic (no I/O, no clock, no db); every
 * assertion names the concrete returned value/shape, never "did not throw".
 * Companion to coerce.test.ts (which is left untouched).
 */

describe("hasMeaningfulPayload — mutation killers", () => {
  // L36:8 ConditionalExpression -> false  (the `(Array.isArray(v) && v.length > 0)` branch)
  // A SPARSE array has length > 0 but NO own enumerable keys, so ONLY the array
  // branch can rescue it — the object branch sees Object.keys([]).length === 0.
  // If the array branch is disabled, this flips true -> false.
  it("a sparse (non-empty, keyless) array is meaningful ONLY via the array branch", () => {
    const sparse = Array(3); // length 3, Object.keys === []
    expect(Object.keys(sparse).length).toBe(0); // guard: the object branch cannot catch it
    expect(hasMeaningfulPayload("", { a: sparse })).toBe(true);
  });

  // L37:8 ConditionalExpression -> true  (the number branch operand forced true)
  // If the number check becomes an unconditional `true`, the `||` chain returns
  // true for ANY value present in data — including a meaningless empty string.
  it("a lone empty-string value stays NOT meaningful (number branch must not be always-true)", () => {
    expect(hasMeaningfulPayload("", { x: "" })).toBe(false);
    // whitespace / empty-array / null / empty-object all remain non-meaningful too
    expect(hasMeaningfulPayload("", { s: "   " })).toBe(false);
    expect(hasMeaningfulPayload("", { z: null })).toBe(false);
    expect(hasMeaningfulPayload("", { o: {} })).toBe(false);
  });

  // Both-sides anchors so a branch flipped to a constant is caught either direction.
  it("a lone finite number IS meaningful (only the number branch can prove it)", () => {
    // v=5: not a string, not an array, not an object → the number branch is the sole path.
    expect(hasMeaningfulPayload("", { n: 5 })).toBe(true);
    expect(hasMeaningfulPayload("", { n: 0 })).toBe(true); // 0 is finite → still meaningful
  });
});

describe("coerceSlot — .trim() removal killers (MethodExpression)", () => {
  // L62:15  asStr(d.text ?? text).trim()  — text family
  it("text family trims surrounding whitespace from data.text", () => {
    expect(coerceSlot("paragraph", { text: "  hi  " }, "ignored", "topic")).toEqual({
      type: "paragraph",
      data: { text: "hi" },
      status: "clean",
    });
  });

  // L69:19  asStr(d.latex ?? text).trim()  — math family
  it("math family trims surrounding whitespace from data.latex", () => {
    expect(coerceSlot("formula", { latex: "  E=mc^2  " }, "", "e")).toEqual({
      type: "formula",
      data: { latex: "E=mc^2" },
      status: "clean",
    });
  });

  // L76:18  asStr(d.markdown).trim()  — mindmap (clean fork)
  it("mindmap trims surrounding whitespace from data.markdown", () => {
    expect(coerceSlot("mindmap", { markdown: "  # Root  " }, "", "m")).toEqual({
      type: "mindmap",
      data: { markdown: "# Root" },
      status: "clean",
    });
  });

  // L78:17  asStr(text).trim()  — mindmap (repaired-from-text fork)
  it("mindmap trims the text arg before splicing it into the repaired markdown", () => {
    expect(coerceSlot("mindmap", {}, "  prose  ", "Topic")).toEqual({
      type: "mindmap",
      data: { markdown: "# Topic\n## prose" },
      status: "repaired",
    });
  });

  // L89:27  asStr(io.content ?? io.text).trim()  — timeline item content
  it("timeline trims surrounding whitespace from an item's content", () => {
    expect(
      coerceSlot("timeline", { items: [{ content: "  Founded  ", start: "1990" }] }, "", "h"),
    ).toEqual({
      type: "timeline",
      data: { items: [{ id: 1, content: "Founded", start: "1990" }] },
      status: "clean",
    });
  });

  // L91:23  asStr(io.start).trim()  — timeline item start.
  // A padded but otherwise-valid date must be trimmed BEFORE the ISO test; without
  // the trim, "  1990  " fails ISO and gets scrubbed (start:"" / repaired) instead of
  // kept (start:"1990" / clean).
  it("timeline trims an item's start so a padded valid date is kept, not scrubbed", () => {
    expect(
      coerceSlot("timeline", { items: [{ content: "E", start: "  1990  " }] }, "", "h"),
    ).toEqual({
      type: "timeline",
      data: { items: [{ id: 1, content: "E", start: "1990" }] },
      status: "clean",
    });
  });

  // L143:18  asStr(d.fn ?? d.expression).trim()  — graph
  it("graph trims surrounding whitespace from the function expression", () => {
    expect(coerceSlot("graph", { fn: "  sin(x)  " }, "", "w")).toEqual({
      type: "graph",
      data: { fn: "sin(x)" },
      status: "clean",
    });
  });
});

describe("coerceSlot — ISO-date regex anchor (L17:13 Regex, trailing $)", () => {
  // Without the trailing `$`, `/^\d{4}(-\d{2}){0,2}/` matches a 4-digit PREFIX like
  // "1990abc", so the junk date would be kept clean instead of scrubbed to "".
  it("a 4-digit-prefixed junk date fails ISO and is scrubbed (repaired), not kept", () => {
    expect(
      coerceSlot("timeline", { items: [{ content: "E", start: "1990abc" }] }, "", "h"),
    ).toEqual({
      type: "timeline",
      data: { items: [{ id: 1, content: "E", start: "" }] },
      status: "repaired",
    });
  });

  // Both-sides anchor: a truly complete ISO date still passes and stays clean.
  it("a full YYYY-MM-DD date passes ISO and is kept clean", () => {
    expect(
      coerceSlot("timeline", { items: [{ content: "E", start: "1990-05-03" }] }, "", "h"),
    ).toEqual({
      type: "timeline",
      data: { items: [{ id: 1, content: "E", start: "1990-05-03" }] },
      status: "clean",
    });
  });
});

describe("coerceSlot — timeline id number check (L96:22 / L96:39)", () => {
  // A NUMERIC id that differs from index+1 pins `typeof io.id === "number"`.
  // If that check is disabled (-> false) or its "number" literal is emptied (-> ""),
  // the numeric id is discarded and replaced with i+1 (== 1 here).
  it("a numeric item id is preserved verbatim, not overwritten with index+1", () => {
    expect(
      coerceSlot("timeline", { items: [{ id: 7, content: "Founded", start: "1990" }] }, "", "h"),
    ).toEqual({
      type: "timeline",
      data: { items: [{ id: 7, content: "Founded", start: "1990" }] },
      status: "clean",
    });
  });
});

describe("coerceSlot — chart point filter (L129:74) & xKey guard (L131:23)", () => {
  // L129:74 LogicalOperator  &&  ->  ||
  // Non-finite numbers (NaN, Infinity) are `typeof === "number"` but NOT finite.
  // With `&&` they are rejected → fewer than 2 valid points → minimal placeholder.
  // With `||` they would pass (type check alone) → a "clean" chart of junk points.
  it("non-finite numeric points are rejected (&& not ||) → minimal placeholder", () => {
    expect(coerceSlot("chart", { data: [{ value: NaN }, { value: Infinity }] }, "", "R")).toEqual({
      type: "chart",
      data: {
        kind: "bar",
        series: [{ key: "value" }],
        data: [{ label: "R", value: 1 }, { label: "—", value: 1 }],
        xKey: "label",
      },
      status: "minimal",
    });
  });

  // L129:74 ConditionalExpression -> true
  // If the whole `typeof v === "number" && Number.isFinite(v)` predicate is forced
  // true, points carrying only non-numeric values would pass. They must NOT.
  it("points with no numeric value are rejected (predicate not always-true) → minimal", () => {
    expect(coerceSlot("chart", { data: [{ label: "a" }, { label: "b" }] }, "", "R")).toEqual({
      type: "chart",
      data: {
        kind: "bar",
        series: [{ key: "value" }],
        data: [{ label: "R", value: 1 }, { label: "—", value: 1 }],
        xKey: "label",
      },
      status: "minimal",
    });
  });

  // Both-sides anchor: two genuinely finite points DO survive and produce a clean chart.
  it("two finite points survive the filter → clean chart", () => {
    expect(
      coerceSlot("chart", { data: [{ value: 1 }, { value: 2 }] }, "", "s"),
    ).toEqual({
      type: "chart",
      data: { kind: "bar", series: [{ key: "value" }], data: [{ value: 1 }, { value: 2 }] },
      status: "clean",
    });
  });

  // L131:23 ConditionalExpression -> true  (`typeof d.xKey === "string"` forced true)
  // When no xKey is supplied, `extra` must be {} — the result must NOT carry an
  // `xKey` key at all. `toEqual` ignores `xKey: undefined`, so assert the key's
  // ABSENCE explicitly to catch the always-true mutation.
  it("omits the xKey property entirely when no string xKey is provided", () => {
    const r = coerceSlot("chart", { data: [{ value: 1 }, { value: 2 }] }, "", "s");
    expect(r.status).toBe("clean");
    expect(r.data).not.toHaveProperty("xKey");
    expect(Object.prototype.hasOwnProperty.call(r.data, "xKey")).toBe(false);
  });

  // Both-sides anchor: a real string xKey IS carried through.
  it("keeps a provided string xKey", () => {
    const r = coerceSlot(
      "chart",
      { xKey: "month", data: [{ month: 0, value: 1 }, { month: 1, value: 2 }] },
      "",
      "s",
    );
    expect(r.data.xKey).toBe("month");
  });
});
