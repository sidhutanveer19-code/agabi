import { describe, it, expect } from "vitest";
import { adaptBlock } from "@/server/conversation/validateBlock";

// Self-contained mutation-killing tests for validateBlock.ts. Each assertion
// pins the EXACT observable value a surviving/uncovered Stryker mutant would
// change, so the mutant's output diverges and the test goes red.
const j = (v: unknown) => JSON.stringify(v);

describe("adaptBlock — coverage mutation kills [validateBlock.cov]", () => {
  // ---- asStr (L31): typeof===string ? v : v==null ? "" : String(v) ----
  // Kills L31:10 cond->true, L31:10 !==, L31:38 inner-cond->true.
  it("asStr coerces a number header to \"42\" and a null cell to \"\" (L31)", () => {
    const r = adaptBlock("table", { headers: [42], rows: [[null]] });
    expect(r.type).toBe("table"); // 42 must become "42" (not raw 42 → schema reject → mindmap)
    expect(r.fallback).toBe(false);
    expect(r.data.headers).toEqual(["42"]); // ->true / !== / inner-""-branch all break this
    expect(r.data.rows).toEqual([[""]]); // null == null → "" (kills the inner "" being anything else)
  });

  // ---- obj (L34): v && typeof v === "object" ? v : {} ----
  it("obj collapses a non-object rawData to {} → empty visual substitutes (L34 cond->true, ->true@15)", () => {
    const r = adaptBlock("image", "hi"); // obj("hi") must be {} → Object.keys len 0 → substitute
    expect(r.type).toBe("mindmap");
    expect(r.fallback).toBe(true);
    expect(r.data.markdown).toBe("# image");
    expect(r.reason).toBe("image: empty data");
  });
  it("obj returns {} for null so d.text does not throw (L34 && -> ||)", () => {
    const r = adaptBlock("paragraph", null); // obj(null) via || would be null → d.text throws → fallback
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("paragraph");
    expect(j(r.data)).toContain('"paragraph"');
  });

  // ---- substitute (L51-53): branch pick, trim, template ----
  it("non-visual/non-math slot substitutes to paragraph, never mindmap (L51 cond->true)", () => {
    const r = adaptBlock("bullet", {}); // list slot → substitute → must be paragraph
    expect(r.type).toBe("paragraph"); // L51 ->true would force mindmap
    expect(r.fallback).toBe(true);
  });
  it("visual substitute trims the body and uses the with-body template (L52 trim, L53 true-branch)", () => {
    const r = adaptBlock("mermaid", {}, "  flow A to B  ");
    expect(r.type).toBe("mindmap");
    expect(r.data.markdown).toBe("# mermaid\n\nflow A to B"); // not "  flow A to B  ", not "# mermaid"
  });
  it("empty visual body yields exactly '# <type>' (L53 else-branch template -> ``)", () => {
    const r = adaptBlock("mermaid", {});
    expect(r.type).toBe("mindmap");
    expect(r.data.markdown).toBe("# mermaid"); // else template emptied would give ""
  });

  // ---- paragraph substitute body + return object (L56-57) ----
  it("paragraph substitute trims real text and keeps it via || (L56 trim/cond/&&, L57 shape)", () => {
    const r = adaptBlock("bullet", { text: "  spaced  " });
    expect(r.type).toBe("paragraph"); // L57 object->{} / ""-type break type
    expect(r.fallback).toBe(true); // L57 fallback:true->false
    expect(r.reason).toBe("list: no valid items");
    expect(j(r.data)).toContain('"paragraph"'); // L57 data->{} removes the doc
    expect(j(r.data)).toContain('"text":"spaced"'); // trimmed via || first operand
    expect(j(r.data)).not.toContain("could not be rendered"); // && mutant would emit the fallback msg
  });
  it("empty paragraph body → '(<type> could not be rendered)' (L56 default string, cond, &&)", () => {
    const r = adaptBlock("bullet", {});
    expect(r.type).toBe("paragraph");
    expect(r.fallback).toBe(true);
    expect(j(r.data)).toContain('"paragraph"');
    expect(j(r.data)).toContain("(bullet could not be rendered)"); // ""/cond->true/false/&& all break this
  });

  // ---- subheading (L68) ----
  it("subheading builds a level-2 heading doc, fallback false (L68 cond, string, objects, bool)", () => {
    const r = adaptBlock("subheading", { text: "Sub" });
    expect(r.type).toBe("subheading"); // L68:41 object->{} / :55 object->{} break type/data
    expect(r.fallback).toBe(false); // L68:95 bool->true
    expect(j(r.data)).toContain('"heading"'); // cond->false / ""-literal would emit a paragraph doc
    expect(j(r.data)).toContain('"level":2');
    expect(j(r.data)).toContain("Sub");
  });

  // ---- admonition (L71): all six types ----
  it("every admonition type emits a real (fallback:false) paragraph doc (L71 cond, objects, bool)", () => {
    for (const t of ["callout", "tip", "warning", "summary", "definition", "example"]) {
      const r = adaptBlock(t, { text: `note-${t}` });
      expect(r.type).toBe(t); // L71:33 object->{} would drop the type
      expect(r.fallback).toBe(false); // L71:81 bool->true
      expect(j(r.data)).toContain('"paragraph"'); // L71:9 cond->false / :47 object->{} would drop the doc
      expect(j(r.data)).toContain(`note-${t}`);
    }
  });

  // ---- math (L74-77) ----
  it("valid math passes through unchanged (L74/78 success path)", () => {
    const r = adaptBlock("formula", { latex: "a^2 + b^2 = c^2" });
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("formula");
    expect(r.data.latex).toBe("a^2 + b^2 = c^2");
  });
  it("empty math substitutes with the exact reason (L77 string)", () => {
    const r = adaptBlock("formula", {});
    expect(r.type).toBe("mindmap");
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("math: empty/invalid latex"); // L77:53 ""
    expect(r.data.markdown).toBe("# formula");
  });

  // ---- list items (L83-89) ----
  it("list keeps each object item's own text (L86:60 ?? defined side)", () => {
    const r = adaptBlock("bullet", { items: [{ text: "one" }, { text: "two" }] });
    expect(r.fallback).toBe(false);
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].text).toBe("one"); // && mutant → asStr(whole item) = "[object Object]"
    expect((r.data.items as { text?: string; checked?: unknown }[])[1].text).toBe("two");
  });
  it("list uses the raw scalar item when it has no .text (L86:60 ?? nullish side)", () => {
    const r = adaptBlock("bullet", { items: ["banana"] });
    expect(r.fallback).toBe(false);
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].text).toBe("banana"); // && mutant → ""
  });
  it("checklist preserves a real boolean checked=true (L86:85 cond->false / !== / :107 \"boolean\"->\"\")", () => {
    const r = adaptBlock("checklist", { items: [{ text: "buy milk", checked: true }] });
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("checklist");
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].checked).toBe(true); // any of those mutants drops it to undefined
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].text).toBe("buy milk");
  });
  it("checklist drops a non-boolean checked so the schema still passes (L86:85 cond->true / !==)", () => {
    const r = adaptBlock("checklist", { items: [{ text: "x", checked: "yes" }] });
    expect(r.fallback).toBe(false); // ->true keeps "yes" → schema fails → fallback true
    expect((r.data.items as { text?: string; checked?: unknown }[])[0].checked).toBeUndefined();
  });
  it("non-array items becomes [] (not a seeded array) → substitute with reason (L83:59 array, L89 cond+string)", () => {
    const r = adaptBlock("bullet", { items: "not-an-array" });
    expect(r.fallback).toBe(true); // seeded ["Stryker…"] would validate → fallback false
    expect(r.type).toBe("paragraph");
    expect(r.reason).toBe("list: no valid items"); // L89:11 cond->false / :53 ""
  });

  // ---- chart (L93-95) ----
  it("valid chart passes through, fallback false (L93 success path)", () => {
    const r = adaptBlock("chart", { kind: "bar", series: [{ key: "value" }], data: [{ label: "A", value: 3 }] });
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("chart");
  });
  it("invalid chart w/o streamText → '# chart' + exact reason (L95 default \"\" and reason)", () => {
    const r = adaptBlock("chart", { nonsense: true });
    expect(r.type).toBe("mindmap");
    expect(r.fallback).toBe(true);
    expect(r.data.markdown).toBe("# chart"); // L95:61 default ""->"Stryker…" would add a body
    expect(r.reason).toBe("chart: invalid shape"); // L95:65 reason->""
  });
  it("invalid chart WITH streamText carries the streamed body (L95 streamText passthrough)", () => {
    const r = adaptBlock("chart", { nonsense: true }, "charts show the trend");
    expect(r.data.markdown).toBe("# chart\n\ncharts show the trend");
  });

  // ---- table (L99-104) ----
  it("table coerces cells and defaults colWidths to 160 per header (L100 map, L102 else)", () => {
    const r = adaptBlock("table", { headers: ["A", "B"], rows: [["1", "2"]] });
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("table");
    expect(r.data.colWidths).toEqual([160, 160]);
  });
  it("table with no headers substitutes (L100:73 else [] not a seeded array)", () => {
    const r = adaptBlock("table", { rows: [["a"]] });
    expect(r.type).toBe("mindmap"); // seeded ["Stryker…"] headers would validate
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("table: invalid shape");
  });
  it("scalar (non-array) row wraps into a single-cell row (L101:103 [asStr(row)] not [])", () => {
    const r = adaptBlock("table", { headers: ["A"], rows: ["scalar"] });
    expect(r.type).toBe("table");
    expect(r.fallback).toBe(false);
    expect(r.data.rows).toEqual([["scalar"]]); // [] mutant → [[]]
  });
  it("missing rows defaults to [] and table stays valid (L101:120 trailing [] not seeded)", () => {
    const r = adaptBlock("table", { headers: ["A"] });
    expect(r.type).toBe("table"); // seeded ["Stryker…"] rows would fail schema → mindmap
    expect(r.fallback).toBe(false);
    expect(r.data.rows).toEqual([]);
  });
  it("colWidths mapped via Number(n) || 160, real values pass through (L102:70 arrow, :77 cond/&&)", () => {
    const r = adaptBlock("table", { headers: ["A", "B"], rows: [["1", "2"]], colWidths: [100, 200] });
    expect(r.type).toBe("table"); // ()=>undefined / ->true / ->false all fail the number schema → mindmap
    expect(r.fallback).toBe(false);
    expect(r.data.colWidths).toEqual([100, 200]); // && mutant would give [160, 160]
  });
  it("colWidths falls back to 160 for a non-numeric entry (L102:77 || right side)", () => {
    const r = adaptBlock("table", { headers: ["A", "B"], rows: [["1", "2"]], colWidths: ["oops", 200] });
    expect(r.type).toBe("table");
    expect(r.data.colWidths).toEqual([160, 200]); // Number("oops") = NaN (falsy) → 160
  });
  it("empty table substitute pins reason + streamText passthrough (L104 cond, ??, default, reason)", () => {
    const empty = adaptBlock("table", {});
    expect(empty.type).toBe("mindmap");
    expect(empty.fallback).toBe(true); // L104:11 cond->false would give fallback false
    expect(empty.reason).toBe("table: invalid shape"); // L104:65 reason->""
    expect(empty.data.markdown).toBe("# table"); // L104:61 default ""->"Stryker…" would add a body

    const streamed = adaptBlock("table", {}, "table of data");
    expect(streamed.data.markdown).toBe("# table\n\ntable of data"); // L104:47 ?? -> && would drop it
  });

  // ---- divider (L108) ----
  it("divider emits { data: {} } with fallback false (L108 cond, string, object, bool)", () => {
    const r = adaptBlock("divider", {});
    expect(r.type).toBe("divider"); // :9 cond->false / :18 ""-literal → falls to VISUAL-empty → mindmap
    expect(r.fallback).toBe(false); // :64 bool->true
    expect(r.data).toEqual({}); // :36 object->{} would strip type
  });

  // ---- graph (L109) ----
  it("graph derives fn from d.fn, fallback false (L109:34/48 objects, :102 bool, :60/84 nullish)", () => {
    const r = adaptBlock("graph", { fn: "x^2" });
    expect(r.type).toBe("graph");
    expect(r.fallback).toBe(false); // :102 bool->true
    expect(r.data).toEqual({ fn: "x^2" }); // :48 object->{}, :60 &&-mutants → "x", :84 ""
  });
  it("graph falls back to d.expression when no fn (L109:9 cond->false, :60 first ??)", () => {
    const r = adaptBlock("graph", { expression: "sin(x)" });
    expect(r.type).toBe("graph");
    expect(r.data).toEqual({ fn: "sin(x)" }); // cond->false → passthrough raw {expression}, no fn key
  });
  it("graph defaults fn to 'x' when empty (L109:84 'x' -> '')", () => {
    const r = adaptBlock("graph", {});
    expect(r.type).toBe("graph");
    expect(r.fallback).toBe(false);
    expect(r.data).toEqual({ fn: "x" }); // ""-default would give { fn: "" }; cond->false → mindmap
  });

  // ---- mermaid (L110-112) ----
  it("valid mermaid passes through (L110-113 success path)", () => {
    const r = adaptBlock("mermaid", { source: "graph TD; A-->B" });
    expect(r.fallback).toBe(false);
    expect(r.type).toBe("mermaid");
    expect(r.data.source).toBe("graph TD; A-->B");
  });
  it("empty mermaid WITH streamText carries the trimmed body (L112:44 ??, L52 trim)", () => {
    const r = adaptBlock("mermaid", {}, "flow A to B");
    expect(r.type).toBe("mindmap");
    expect(r.data.markdown).toBe("# mermaid\n\nflow A to B"); // ?? -> && would drop streamText → "# mermaid"
  });
  it("empty mermaid w/o streamText → '# mermaid' + exact reason (L112:58 default, :62 reason)", () => {
    const r = adaptBlock("mermaid", {});
    expect(r.type).toBe("mindmap");
    expect(r.data.markdown).toBe("# mermaid"); // default ""->"Stryker…" would add a body
    expect(r.reason).toBe("mermaid: empty"); // reason->""
  });

  // ---- empty visual data → substitute (L117-118) ----
  it("empty visual data substitutes with exact '<type>: empty data' reason (L118 default, reason)", () => {
    const r = adaptBlock("image", {});
    expect(r.type).toBe("mindmap");
    expect(r.fallback).toBe(true);
    expect(r.data.markdown).toBe("# image"); // L118:45 default ""->"Stryker…" would add a body
    expect(r.reason).toBe("image: empty data"); // L118:49 reason template -> ``
  });

  // ---- passthrough visual with data (L121) ----
  it("visual with real data is emitted as-is, fallback false (L121:51 bool->true)", () => {
    const r = adaptBlock("timeline", { foo: "bar" }, "streamed");
    expect(r.type).toBe("timeline");
    expect(r.fallback).toBe(false); // bool mutant would flip fallback to true
    expect(r.data).toEqual({ foo: "bar" });
    expect(r.streamText).toBe("streamed");
  });

  // ---- catch (L122-123) ----
  it("a throw inside try is caught and substituted (L122:17 block, L123 ??/default/reason)", () => {
    const boom = {
      get text() {
        throw new Error("boom");
      },
    };
    const r = adaptBlock("paragraph", boom);
    expect(r).toBeDefined(); // emptied catch block would return undefined
    expect(r.type).toBe("paragraph");
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe("exception: boom"); // L123:47 reason->`` / static prefix mutation
    expect(j(r.data)).toContain("(paragraph could not be rendered)"); // L123:43 default ""->"Stryker…"
  });
  it("a throw WITH streamText keeps the streamed body (L123:29 ?? -> &&)", () => {
    const boom = {
      get text() {
        throw new Error("boom");
      },
    };
    const r = adaptBlock("paragraph", boom, "streamed text");
    expect(r.type).toBe("paragraph");
    expect(r.fallback).toBe(true);
    expect(j(r.data)).toContain("streamed text"); // && mutant → "" → "(paragraph could not be rendered)"
  });
});
