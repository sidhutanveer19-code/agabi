import { describe, it, expect } from "vitest";
import type { TeachRequest, TeachContext } from "@contract/schemas";
import {
  PROMPT_VERSION,
  userPrompt,
  regionTitle,
  shapeHint,
  slotPrompt,
  slotShapePrompt,
  batchPrompt,
  jsonSlotUser,
  textStreamUser,
  outlineSystemPrompt,
  systemPrompt,
  teachingStyle,
} from "@/server/conversation/prompt";

// These are the AUTHORITATIVE hint strings from blockTypes.BLOCK_HINTS, hardcoded here so the test
// asserts the REAL literal output (not a value re-derived through the code under test — that would be
// tautological, §H1.2). If a hint text changes in the source, these assertions SHOULD break.
const HINT_HEADING = "{ text: string } — a short title line";
const HINT_PARAGRAPH = "{ text: string } — one paragraph of prose";
const HINT_TABLE = "{ headers: string[], rows: string[][] }";
const HINT_CHART =
  "{ kind: 'bar'|'line'|'area'|'pie'|'scatter', series: [{key:string}], data: [{label:string, value:number}], xKey?: string }";

// A minimal, schema-shaped TeachRequest builder — keeps every case a valid TeachRequest.
const req = (r: Partial<TeachRequest> & { kind: TeachRequest["kind"] }): TeachRequest => ({
  topic: "",
  ...r,
});

describe("PROMPT_VERSION — provenance token is exact and stable", () => {
  it("is exactly 1.1.0 (compared exactly per the doc comment; a silent bump breaks provenance)", () => {
    expect(PROMPT_VERSION).toBe("1.1.0");
  });
});

describe("shapeHint — resolves a single type to its BLOCK_HINTS string", () => {
  it("returns the DIRECT hint when the type is a whole key (chart)", () => {
    expect(shapeHint("chart")).toBe(HINT_CHART);
    expect(shapeHint("table")).toBe(HINT_TABLE);
  });
  it("resolves a grouped/slashed key by segment membership (heading → heading/subheading)", () => {
    expect(shapeHint("heading")).toBe(HINT_HEADING);
    expect(shapeHint("subheading")).toBe(HINT_HEADING);
  });
  it("resolves a type embedded in a parenthesised key via substring (paragraph)", () => {
    expect(shapeHint("paragraph")).toBe(HINT_PARAGRAPH);
    expect(shapeHint("quote")).toBe(HINT_PARAGRAPH);
  });
  it("returns '' for an unknown type (the fallback branch)", () => {
    expect(shapeHint("totally-unknown-xyz")).toBe("");
    expect(shapeHint("banana")).toBe("");
  });
  it("EDGE: empty string matches the FIRST key via includes('') — documents the real quirk", () => {
    // ''.includes -> every key `.includes("")` is true, so `.find` returns the first entry.
    // This is a genuine (subtle) behaviour of the current code; asserting it pins the contract.
    expect(shapeHint("")).toBe(HINT_PARAGRAPH);
  });
});

describe("userPrompt — builds the exact instruction string per request kind", () => {
  it("QUESTION with text: trims the question and the topic, embeds both", () => {
    const out = userPrompt(req({ kind: "question", topic: "  Fractions  ", text: "  what is 1/2?  " }));
    expect(out).toBe(
      'The student asked: "what is 1/2?"\nAnswer it as a short, self-contained explanation region about Fractions.',
    );
  });

  it("COMMAND that IS in the map: uses the mapped instruction verbatim", () => {
    const out = userPrompt(req({ kind: "command", topic: "Photosynthesis", command: "simpler" }));
    expect(out).toBe(
      "Re-explain the current idea in much simpler terms. Topic: Photosynthesis. Produce a NEW short explanation region.",
    );
  });

  it("COMMAND that is NOT in the map: falls back to the generic 'Act on the command' form", () => {
    const out = userPrompt(req({ kind: "command", topic: "Photosynthesis", command: "zoom" }));
    expect(out).toBe(
      'Act on the command "zoom". Topic: Photosynthesis. Produce a NEW short explanation region.',
    );
  });

  it("LESSON default path: 'Teach the topic: X.'", () => {
    expect(userPrompt(req({ kind: "lesson", topic: "Gravity" }))).toBe("Teach the topic: Gravity.");
  });

  it("EDGE: blank topic collapses to the 'this idea' fallback", () => {
    expect(userPrompt(req({ kind: "lesson", topic: "    " }))).toBe("Teach the topic: this idea.");
  });

  it("EDGE: kind=question but NO text → does NOT take the question branch, falls through to lesson", () => {
    expect(userPrompt(req({ kind: "question", topic: "Osmosis" }))).toBe("Teach the topic: Osmosis.");
  });

  it("EDGE: kind=command but NO command field → falls through to lesson", () => {
    expect(userPrompt(req({ kind: "command", topic: "Osmosis" }))).toBe("Teach the topic: Osmosis.");
  });

  it("EDGE: kind=question with empty-string text → falsy, falls through to lesson", () => {
    expect(userPrompt(req({ kind: "question", topic: "Osmosis", text: "" }))).toBe("Teach the topic: Osmosis.");
  });

  it("CONTEXT tail: appends the earlier explanations, joined by '; '", () => {
    const ctx: TeachContext = {
      topic: "Osmosis",
      explanations: [
        { regionId: "r1", title: "Cells", kind: "lesson" },
        { regionId: "r2", title: "Diffusion", kind: "lesson" },
      ],
      selectedRegionId: null,
    };
    expect(userPrompt(req({ kind: "lesson", topic: "Osmosis" }), ctx)).toBe(
      "Teach the topic: Osmosis.\nEarlier in this session you explained: Cells; Diffusion.",
    );
  });

  it("CONTEXT with EMPTY explanations array → no tail added", () => {
    const ctx: TeachContext = { topic: "Osmosis", explanations: [], selectedRegionId: null };
    expect(userPrompt(req({ kind: "lesson", topic: "Osmosis" }), ctx)).toBe("Teach the topic: Osmosis.");
  });

  it("CONTEXT undefined → no tail (default arg)", () => {
    expect(userPrompt(req({ kind: "lesson", topic: "Osmosis" }))).toBe("Teach the topic: Osmosis.");
  });

  it("QUESTION tail is appended too (context flows into the question branch)", () => {
    const ctx: TeachContext = {
      topic: "Osmosis",
      explanations: [{ regionId: "r1", title: "Cells", kind: "lesson" }],
      selectedRegionId: null,
    };
    expect(userPrompt(req({ kind: "question", topic: "Osmosis", text: "why?" }), ctx)).toBe(
      'The student asked: "why?"\nAnswer it as a short, self-contained explanation region about Osmosis.\nEarlier in this session you explained: Cells.',
    );
  });
});

describe("regionTitle — the streamed region's title per request kind", () => {
  it("QUESTION with text → the trimmed question", () => {
    expect(regionTitle(req({ kind: "question", topic: "T", text: "  What is pi?  " }))).toBe("What is pi?");
  });
  it("COMMAND in the map → the mapped label", () => {
    expect(regionTitle(req({ kind: "command", topic: "T", command: "why" }))).toBe("Why");
    expect(regionTitle(req({ kind: "command", topic: "T", command: "whatif" }))).toBe("What if");
  });
  it("COMMAND not in the map → 'Explanation'", () => {
    expect(regionTitle(req({ kind: "command", topic: "T", command: "zoom" }))).toBe("Explanation");
  });
  it("LESSON → the trimmed topic", () => {
    expect(regionTitle(req({ kind: "lesson", topic: "  Real Numbers  " }))).toBe("Real Numbers");
  });
  it("EDGE: blank topic on lesson → 'Lesson' fallback", () => {
    expect(regionTitle(req({ kind: "lesson", topic: "   " }))).toBe("Lesson");
  });
  it("EDGE: question with no text → falls through to topic (not the question branch)", () => {
    expect(regionTitle(req({ kind: "question", topic: "Vectors" }))).toBe("Vectors");
  });
});

describe("textStreamUser — per-type prose instruction", () => {
  it("heading/subheading → 'a short title, 3-6 words'", () => {
    expect(textStreamUser("Algebra", { type: "heading", intent: "the topic" })).toBe(
      "Lesson topic: Algebra.\nWrite a short title, 3-6 words for this block, which teaches: the topic.",
    );
    expect(textStreamUser("Algebra", { type: "subheading", intent: "sub" })).toBe(
      "Lesson topic: Algebra.\nWrite a short title, 3-6 words for this block, which teaches: sub.",
    );
  });
  it("summary → '3-4 short sentences recapping the lesson'", () => {
    expect(textStreamUser("Algebra", { type: "summary", intent: "recap" })).toBe(
      "Lesson topic: Algebra.\nWrite 3-4 short sentences recapping the lesson for this block, which teaches: recap.",
    );
  });
  it("callout/tip/warning → 'one memorable sentence'", () => {
    for (const type of ["callout", "tip", "warning"]) {
      expect(textStreamUser("Algebra", { type, intent: "key point" })).toBe(
        `Lesson topic: Algebra.\nWrite one memorable sentence for this block, which teaches: key point.`,
      );
    }
  });
  it("any other type (paragraph) → '2-3 clear sentences'", () => {
    expect(textStreamUser("Algebra", { type: "paragraph", intent: "explain" })).toBe(
      "Lesson topic: Algebra.\nWrite 2-3 clear sentences for this block, which teaches: explain.",
    );
  });
});

describe("jsonSlotUser — bare-JSON instruction with the resolved shape", () => {
  it("known type embeds the resolved shape", () => {
    expect(jsonSlotUser("Trade", { type: "table", intent: "compare imports vs exports" })).toBe(
      `Lesson topic: Trade.\nProduce the data for one table block that teaches: compare imports vs exports.\nReturn ONLY a JSON object with exactly this shape: ${HINT_TABLE}.`,
    );
  });
  it("EDGE: unknown type → shape falls back to '{ ... }'", () => {
    expect(jsonSlotUser("Trade", { type: "no-such-type", intent: "x" })).toBe(
      "Lesson topic: Trade.\nProduce the data for one no-such-type block that teaches: x.\nReturn ONLY a JSON object with exactly this shape: { ... }.",
    );
  });
});

describe("slotPrompt — Phase-3 single-slot fill", () => {
  it("with a shape AND prior intents: both lines present", () => {
    expect(slotPrompt("Energy", { type: "chart", intent: "show the trend" }, ["intro", "the law"])).toBe(
      `Lesson topic: Energy.\nFill this one block.\nBlock type: chart.\nIt should teach: show the trend.\nExpected \`data\` shape: ${HINT_CHART}.\nAlready covered in this lesson (do NOT repeat): intro; the law.\nCall your single tool exactly once.`,
    );
  });
  it("no prior intents → no 'Already covered' line", () => {
    expect(slotPrompt("Energy", { type: "chart", intent: "trend" }, [])).toBe(
      `Lesson topic: Energy.\nFill this one block.\nBlock type: chart.\nIt should teach: trend.\nExpected \`data\` shape: ${HINT_CHART}.\nCall your single tool exactly once.`,
    );
  });
  it("unknown type → no shape line", () => {
    expect(slotPrompt("Energy", { type: "ghost", intent: "trend" }, [])).toBe(
      "Lesson topic: Energy.\nFill this one block.\nBlock type: ghost.\nIt should teach: trend.\nCall your single tool exactly once.",
    );
  });
});

describe("slotShapePrompt — RUNG-3 attempt-2, shape only", () => {
  it("with a shape: includes ' Shape: <shape>.'", () => {
    expect(slotShapePrompt({ type: "table", intent: "compare" })).toBe(
      `Fill one table block about "compare". Shape: ${HINT_TABLE}. Call the tool once with the data.`,
    );
  });
  it("unknown type: no shape fragment", () => {
    expect(slotShapePrompt({ type: "ghost", intent: "compare" })).toBe(
      'Fill one ghost block about "compare". Call the tool once with the data.',
    );
  });
});

describe("batchPrompt — RUNG-1 whole-plan message", () => {
  it("prints each slot with its shape and the fixed preamble (exact)", () => {
    const out = batchPrompt("Photosynthesis", [
      { slot: 1, type: "heading", intent: "title" },
      { slot: 2, type: "chart", intent: "data" },
    ]);
    expect(out).toBe(
      [
        "Lesson topic: Photosynthesis.",
        "Fill EVERY slot below by calling emit_block once per slot — pass the slot number,",
        "and the content (text blocks use `text`; visual blocks use `data` in the shape shown).",
        "Do not repeat a slot. Stop once every slot is filled.",
        "",
        `  slot 1 — heading — title\n     shape: ${HINT_HEADING}`,
        `  slot 2 — chart — data\n     shape: ${HINT_CHART}`,
      ].join("\n"),
    );
  });
  it("a slot with an unknown type prints no shape line", () => {
    const out = batchPrompt("X", [{ slot: 5, type: "ghost", intent: "y" }]);
    expect(out.endsWith("  slot 5 — ghost — y")).toBe(true);
    expect(out).not.toMatch(/shape:/);
  });
  it("EDGE: empty outline → just the preamble, no slot lines", () => {
    const out = batchPrompt("X", []);
    expect(out).toBe(
      [
        "Lesson topic: X.",
        "Fill EVERY slot below by calling emit_block once per slot — pass the slot number,",
        "and the content (text blocks use `text`; visual blocks use `data` in the shape shown).",
        "Do not repeat a slot. Stop once every slot is filled.",
        "",
      ].join("\n"),
    );
  });
});

describe("teachingStyle / systemPrompt / outlineSystemPrompt — the mentor contract & structure", () => {
  it("teachingStyle carries every mentor pillar (mechanism, analogy, use/avoid, real-world, no hedging)", () => {
    const s = teachingStyle();
    expect(s).toMatch(/TEACH LIKE A MENTOR/);
    expect(s).toMatch(/MECHANISM/);
    expect(s).toMatch(/Do NOT restate or reword a definition\./);
    expect(s).toMatch(/ANALOGY/);
    expect(s).toMatch(/when to USE it, when to AVOID it/);
    expect(s).toMatch(/REAL-WORLD/);
    expect(s).toMatch(/No hedging, no 'certainly'/);
    // exactly 7 lines (joined by \n) — a structural guard so a dropped pillar is caught
    expect(s.split("\n")).toHaveLength(7);
  });

  it("systemPrompt states the hard rules AND embeds the block catalog", () => {
    const p = systemPrompt();
    expect(p).toMatch(/R1\. Emit 7 to 10 blocks total/);
    expect(p).toMatch(/R2\. At least 3 blocks MUST come from the VISUAL LIST/);
    expect(p).toMatch(/R4\. First block is always `heading`\. Last block is always exactly one `summary`\./);
    // blockCatalog() is inlined → the concrete type list and a known hint must appear
    expect(p).toMatch(/Available block types/);
    expect(p).toContain("paragraph, richtext, heading");
    expect(p).toContain(HINT_TABLE);
    expect(p).toMatch(/For text\/heading\/admonition blocks pass simply `\{ text: string \}`\./);
  });

  it("outlineSystemPrompt asks for a JSON slot array with heading-first / summary-last", () => {
    const p = outlineSystemPrompt();
    expect(p).toMatch(/Return ONLY a JSON array of slots/);
    expect(p).toMatch(/\{ slot: number, type: string, intent: string \}/);
    expect(p).toMatch(/First slot type is `heading`\. Last slot type is `summary`\./);
    expect(p).toMatch(/7 to 9 slots/);
  });
});
