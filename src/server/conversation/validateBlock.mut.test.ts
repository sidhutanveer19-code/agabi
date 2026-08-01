import { describe, it, expect } from "vitest";
import { adaptBlock } from "@/server/conversation/validateBlock";

// Mutation-killing tests for validateBlock.ts. Each assertion pins the EXACT
// observable behavior a surviving/uncovered Stryker mutant would change.
const j = (v: unknown) => JSON.stringify(v);

describe("adaptBlock — mutation kills [validateBlock]", () => {
  // ---- asStr (line 31): typeof/==null/String/"" ----
  it("asStr coerces number header via String(v) and null cell to '' (line 31)", () => {
    const r = adaptBlock("table", { headers: [42], rows: [[null]] });
    expect(r.type).toBe("table"); // 42 must become the string "42", not raw 42 (schema would reject) and not ""
    expect(r.fallback).toBe(false);
    expect(r.data.headers).toEqual(["42"]); // kills cond->true/false, !== , and inner-ternary->"" mutants
    expect(r.data.rows).toEqual([[""]]); // null == null → "" (kills the "" string-literal mutant)
  });

  // ---- obj (line 34): v && typeof===object ? v : {} ----
  it("obj treats a non-object rawData as {} (line 34 cond->v)", () => {
    const r = adaptBlock("image", "hi"); // "hi" must collapse to {} → Object.keys len 0 → substitute
    expect(r.type).toBe("mindmap");
    expect(r.fallback).toBe(true);
    expect(r.data.markdown).toBe("# image");
  });

  it("obj returns {} for null, so no throw and a real block (line 34 && -> ||)", () => {
    const r = adaptBlock("paragraph", null); // if obj(null) returned null, d.text would throw → fallback
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("paragraph");
    expect(j(r.data)).toContain('"paragraph"');
  });

  // ---- substitute (lines 50-57) ----
  it("visual substitute trims the body + keeps streamText (lines 52 & 112)", () => {
    const r = adaptBlock("mermaid", {}, "  flow A to B  ");
    expect(r.type).toBe("mindmap");
    expect(r.data.markdown).toBe("# mermaid\n\nflow A to B"); // trimmed; not "  flow A to B  " and not "# mermaid"
  });

  it("empty visual body yields exactly '# <type>' with exact reason (lines 53 & 112)", () => {
    const r = adaptBlock("mermaid", {});
    expect(r.type).toBe("mindmap");
    expect(r.fallback).toBe(true);
    expect(r.data.markdown).toBe("# mermaid"); // second template branch, no body prefix mutation
    expect(r.reason).toBe("mermaid: empty");
  });

  it("a non-visual/non-math slot substitutes to paragraph, not mindmap (line 51)", () => {
    const r = adaptBlock("bullet", { text: "  spaced  " });
    expect(r.type).toBe("paragraph"); // list slot is NOT visual/math → must be paragraph
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("list: no valid items");
    expect(j(r.data)).toContain('"text":"spaced"'); // trimmed body kept via `text.trim() || …` (line 56)
  });

  it("empty paragraph body → '(<type> could not be rendered)' with paragraph shape (lines 56-57)", () => {
    const r = adaptBlock("bullet", {});
    expect(r.type).toBe("paragraph");
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("list: no valid items");
    expect(j(r.data)).toContain("(bullet could not be rendered)"); // kills the "" default + object/bool mutants
  });

  // ---- subheading (line 68) ----
  it("subheading builds a level-2 heading doc, fallback false (line 68)", () => {
    const r = adaptBlock("subheading", { text: "Sub" });
    expect(r.type).toBe("subheading");
    expect(r.fallback).toBe(false);
    expect(j(r.data)).toContain('"heading"');
    expect(j(r.data)).toContain('"level":2');
    expect(j(r.data)).toContain("Sub");
  });

  // ---- admonition (line 71) ----
  it("admonition (callout) wraps text in a paragraph doc, fallback false (line 71)", () => {
    const r = adaptBlock("callout", { text: "Note this" });
    expect(r.type).toBe("callout");
    expect(r.fallback).toBe(false);
    expect(j(r.data)).toContain('"paragraph"'); // cond->false would emit raw {text} without a doc
    expect(j(r.data)).toContain("Note this");
  });

  // ---- math fallback reason (line 77) ----
  it("empty math substitutes with the exact reason (line 77)", () => {
    const r = adaptBlock("formula", {});
    expect(r.type).toBe("mindmap");
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("math: empty/invalid latex");
    expect(r.data.markdown).toBe("# formula");
  });

  // ---- list items (lines 83-89) ----
  it("list keeps each object item's own text (line 86 `io.text ?? it`, defined side)", () => {
    const r = adaptBlock("bullet", { items: [{ text: "one" }, { text: "two" }] });
    expect(r.fallback).toBe(false);
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].text).toBe("one"); // `&&` mutant would stringify the whole item object
    expect((r.data.items as { text?: string; checked?: unknown }[])[1].text).toBe("two");
  });

  it("list uses the raw scalar item when it has no .text (line 86, nullish side)", () => {
    const r = adaptBlock("bullet", { items: ["banana"] });
    expect(r.fallback).toBe(false);
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].text).toBe("banana"); // `&&` mutant would yield ""
  });

  it("checklist preserves a real boolean checked=true (line 86 checked branch)", () => {
    const r = adaptBlock("checklist", { items: [{ text: "buy milk", checked: true }] });
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("checklist");
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].checked).toBe(true); // cond->false / !== / "boolean"->"" would drop it → undefined
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].text).toBe("buy milk");
  });

  it("checklist drops a non-boolean checked so the schema still passes (line 86 checked cond->true)", () => {
    const r = adaptBlock("checklist", { items: [{ text: "x", checked: "yes" }] });
    expect(r.fallback).toBe(false); // cond->true would keep "yes" → schema fails → fallback true
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].checked).toBeUndefined();
  });

  it("non-array items becomes [] (not a seeded array) → substitute (lines 83 & 89)", () => {
    const r = adaptBlock("bullet", { items: "not-an-array" });
    expect(r.fallback).toBe(true); // a seeded ["Stryker…"] array would succeed → fallback false
    expect(r.type).toBe("paragraph");
    expect(r.reason).toBe("list: no valid items"); // kills `if (!r.success)`->false too
  });

  // ---- chart fallback (line 95) ----
  it("invalid chart without streamText → '# chart' + exact reason (line 95)", () => {
    const r = adaptBlock("chart", { nonsense: true });
    expect(r.type).toBe("mindmap");
    expect(r.fallback).toBe(true);
    expect(r.data.markdown).toBe("# chart"); // `streamText ?? ""` empty side, no seeded body
    expect(r.reason).toBe("chart: invalid shape");
  });

  // ---- table (lines 100-104) ----
  it("table with no headers substitutes (line 100 `[]` default)", () => {
    const r = adaptBlock("table", { rows: [["a"]] });
    expect(r.type).toBe("mindmap"); // seeded ["Stryker…"] headers would make it a valid table
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("table: invalid shape");
  });

  it("scalar (non-array) row is wrapped into a single-cell row (line 101 `[asStr(row)]`)", () => {
    const r = adaptBlock("table", { headers: ["A"], rows: ["scalar"] });
    expect(r.type).toBe("table");
    expect(r.fallback).toBe(false);
    expect(r.data.rows).toEqual([["scalar"]]); // `[]` mutant would yield [[]]
  });

  it("missing rows defaults to [] and table stays valid (line 101 trailing `[]`)", () => {
    const r = adaptBlock("table", { headers: ["A"] });
    expect(r.type).toBe("table"); // seeded ["Stryker…"] rows would fail schema → mindmap
    expect(r.fallback).toBe(false);
    expect(r.data.rows).toEqual([]);
  });

  it("colWidths mapped via `Number(n) || 160`, passing values through (line 102)", () => {
    const r = adaptBlock("table", { headers: ["A", "B"], rows: [["1", "2"]], colWidths: [100, 200] });
    expect(r.type).toBe("table"); // ()=>undefined or ->true would fail schema → mindmap
    expect(r.fallback).toBe(false);
    expect(r.data.colWidths).toEqual([100, 200]); // && / ->false would give [160,160]
  });

  it("invalid table substitute pins reason + streamText passthrough (line 104)", () => {
    const empty = adaptBlock("table", {});
    expect(empty.type).toBe("mindmap");
    expect(empty.fallback).toBe(true); // `if (!r.success)`->false would give fallback false
    expect(empty.reason).toBe("table: invalid shape");
    expect(empty.data.markdown).toBe("# table"); // no streamText → no body

    const streamed = adaptBlock("table", {}, "table of data");
    expect(streamed.data.markdown).toBe("# table\n\ntable of data"); // `?? -> &&` would drop streamText
  });

  // ---- divider (line 108) ----
  it("divider emits { data: {} } with fallback false (line 108)", () => {
    const r = adaptBlock("divider", {});
    expect(r.type).toBe("divider"); // cond->false / ""-type / object->{} would break this
    expect(r.fallback).toBe(false);
    expect(r.data).toEqual({});
  });

  // ---- graph (line 109) ----
  it("graph derives fn from d.fn (line 109)", () => {
    const r = adaptBlock("graph", { fn: "x^2" });
    expect(r.type).toBe("graph");
    expect(r.fallback).toBe(false);
    expect(r.data).toEqual({ fn: "x^2" }); // both `??` / object / bool mutants change this
  });

  it("graph falls back to d.expression when no fn (line 109 first `??` + cond->false)", () => {
    const r = adaptBlock("graph", { expression: "sin(x)" });
    expect(r.type).toBe("graph");
    expect(r.data).toEqual({ fn: "sin(x)" }); // cond->false would emit raw {expression} (no fn key)
  });

  it("graph defaults fn to 'x' when empty (line 109 'x' -> '')", () => {
    const r = adaptBlock("graph", {});
    expect(r.type).toBe("graph");
    expect(r.fallback).toBe(false);
    expect(r.data).toEqual({ fn: "x" });
  });

  // ---- empty visual data → substitute (line 118) ----
  it("empty visual data substitutes with exact '<type>: empty data' reason (line 118)", () => {
    const r = adaptBlock("image", {});
    expect(r.type).toBe("mindmap");
    expect(r.fallback).toBe(true);
    expect(r.data.markdown).toBe("# image"); // `streamText ?? ""` empty side → no body
    expect(r.reason).toBe("image: empty data");
  });

  // ---- passthrough visual with data (line 121) ----
  it("visual with real data is emitted as-is, fallback false (line 121)", () => {
    const r = adaptBlock("timeline", { foo: "bar" }, "streamed");
    expect(r.type).toBe("timeline");
    expect(r.fallback).toBe(false); // bool mutant would flip fallback to true
    expect(r.data).toEqual({ foo: "bar" });
    expect(r.streamText).toBe("streamed");
  });

  // ---- catch (lines 122-123) ----
  it("a throw inside try is caught and substituted (lines 122-123)", () => {
    const boom = {
      get text() {
        throw new Error("boom");
      },
    };
    const r = adaptBlock("paragraph", boom);
    expect(r).toBeDefined(); // emptied catch block would return undefined
    expect(r.type).toBe("paragraph");
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("exception: boom"); // reason template prefix must survive
    expect(j(r.data)).toContain("(paragraph could not be rendered)"); // empty text → default body

    const streamed = adaptBlock("paragraph", boom, "streamed text");
    expect(j(streamed.data)).toContain("streamed text"); // `streamText ?? ""` (not `&&`) keeps it
  });

  // ---- admonition fallback flag (line 71:81 `fallback: false` -> true) ----
  // The pre-existing callout test pins the doc shape but not the flag, so the
  // BooleanLiteral mutant on line 71's `fallback: false` survived. Every
  // ADMONITION_TYPES value must take line 71 and report a *non*-fallback block.
  it("every admonition type emits a real (fallback:false) paragraph doc (line 71 boolean)", () => {
    for (const t of ["callout", "tip", "warning", "summary", "definition", "example"]) {
      const r = adaptBlock(t, { text: `note-${t}` });
      expect(r.type).toBe(t);
      expect(r.fallback).toBe(false); // `fallback: false` -> true would flip this
      expect(j(r.data)).toContain('"paragraph"'); // still the ProseMirror doc, not raw {text}
      expect(j(r.data)).toContain(`note-${t}`);
    }
  });
});
