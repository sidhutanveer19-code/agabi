import { describe, it, expect } from "vitest";
import type { TeachRequest, TeachContext } from "@contract/schemas";
import {
  teachingStyle,
  systemPrompt,
  outlineSystemPrompt,
  batchSystemPrompt,
  jsonSlotSystem,
  textStreamSystem,
  userPrompt,
  regionTitle,
} from "@/server/conversation/prompt";

// ---------------------------------------------------------------------------
// These tests PIN the exact literal output of every prompt-producing function
// so that mutating ANY string line to "" / "Stryker was here!", flipping a
// join separator, dropping a `.filter(Boolean)`, weakening a regex anchor, or
// removing an optional-chain is caught by an exact-equality assertion.
//
// Every expected value below is a HARDCODED literal (§H1.2 — never re-derived
// through the code under test), transcribed from the source and from the
// authoritative blockTypes registry. If a prompt line changes, these SHOULD
// break — that is the point: the prompt version rides on provenance.
// ---------------------------------------------------------------------------

// The mentor teaching contract — the 7 lines of teachingStyle(), verbatim.
const EXPECTED_TEACHING = [
  "TEACH LIKE A MENTOR, not a summarizer — build understanding and judgment, not recall.",
  "For each block, teach the MECHANISM: how and why it works, and why the obvious alternative FAILS —",
  "never the textbook definition. Do NOT restate or reword a definition.",
  "Lead with INTUITION: a mechanism-revealing everyday ANALOGY (factory, city, restaurant, an OS),",
  "never an empty one — understanding before vocabulary.",
  "Place the idea: when to USE it, when to AVOID it, and connect it to a REAL-WORLD example.",
  "Plain words for a 14–16 year old. Simple first, then depth. No hedging, no 'certainly'.",
].join("\n");

// The BLOCK_TYPES list, comma-joined, exactly as blockCatalog() prints it.
const EXPECTED_BLOCK_TYPES_LINE =
  "paragraph, richtext, heading, subheading, quote, notes, caption, callout, tip, warning, summary, definition, example, bullet, numbered, checklist, formula, equation, inline-equation, display-equation, divider, image, table, chart, basic-diagram, flow, mermaid, excalidraw, tldraw, graph, monaco, geometry, mathfield, threed, physics, molecule, figure, map, timeline, mindmap, video, audio, gallery, document, embed";

// Every BLOCK_HINTS entry rendered as `- ${key}: ${value}` — the hint block
// blockCatalog() appends. Note: mindmap's hint contains LITERAL backslash-n.
const EXPECTED_HINT_LINES = [
  "- text (paragraph/quote/notes/caption/richtext): { text: string } — one paragraph of prose",
  "- heading/subheading: { text: string } — a short title line",
  "- admonition (callout/tip/warning/summary/definition/example): { text: string } — a highlighted note",
  "- bullet/numbered/checklist: { items: [{ text: string, checked?: boolean }] }",
  "- formula/equation/inline-equation/display-equation: { latex: string } — valid KaTeX",
  "- chart: { kind: 'bar'|'line'|'area'|'pie'|'scatter', series: [{key:string}], data: [{label:string, value:number}], xKey?: string }",
  "- table: { headers: string[], rows: string[][] }",
  "- basic-diagram: { nodes: [{id,x,y,label}], edges: [{id,from,to}] }",
  "- mermaid: { source: string } — valid Mermaid syntax (e.g. 'graph TD; A-->B')",
  "- flow: { nodes: [...], edges: [...] } — React Flow shape",
  "- graph: { fn: string } — a function of x, e.g. 'x^2'",
  "- mathfield: { latex: string }",
  "- divider: {} — a horizontal rule",
  "- image: { src: string (https), alt?: string, caption?: string }",
  "- video: { src: string (https), poster?: string }",
  "- document: { url: string (https pdf) }",
  "- embed: { url: string (https), title?: string }",
  "- timeline: { items: [{ id: number, content: string, start: 'YYYY-MM-DD' }] } — dates must be ISO",
  "- mindmap: { markdown: string } — markdown headings only, e.g. '# Topic\\n## Branch A\\n### Leaf\\n## Branch B'",
  "- map: { center: [lng, lat], zoom: number, markers: [{ lng, lat, label }] } — lng FIRST",
  "- geometry: { points: [{id,x,y,name}], segments: [[fromId,toId]] } — for triangles, angles, constructions",
  "- molecule: { format: 'xyz', data: string } — XYZ text: line1 = atom count, line2 = name, then 'SYMBOL x y z' per line",
  "- threed: { shapes: [{ type: 'sphere'|'box', position: [x,y,z], color: '#hex' }] }",
  "- physics: { preset: 'gravity' } — a named simulation preset",
  "- figure: { src: string (https image), alt: string, labels: [{id,x,y,text}] } — x/y are 0..1 fractions. NEEDS a real image URL; skip this block if you do not have one",
  "- monaco: { code: string, language: string }",
  "- gallery: { images: [{ src, caption? }] }",
  "- audio: { src: string (https), title: string }",
];

// blockCatalog()'s exact output — inlined into systemPrompt() at slot 71.
const EXPECTED_CATALOG =
  "Available block types (pass one of these exact `type` values — text types via emit_text, visual types via emit_visual):\n" +
  EXPECTED_BLOCK_TYPES_LINE +
  "\n\nShapes for the common ones (pass as `data`):\n" +
  EXPECTED_HINT_LINES.join("\n");

// systemPrompt()'s array, verbatim (lines 87..159 of prompt.ts), with the
// catalog inlined and the empty "" separator lines kept in place.
const EXPECTED_SYSTEM = [
  "You are Agabi. You build visual lessons on an infinite canvas for a student aged 14-16.",
  "You teach ONLY by calling tools. Text blocks (heading, paragraph, bullet, callout,",
  "summary) go through `emit_text`; visual blocks (formula, chart, table, diagram, …) go",
  "through `emit_visual`. One call per block, in reading order.",
  "Never write prose outside a tool call. Never announce what you are about to do.",
  "",
  "==== HARD RULES — verify every one before you stop ====",
  "R1. Emit 7 to 10 blocks total, then stop calling the tool.",
  "R2. At least 3 blocks MUST come from the VISUAL LIST. A text-only lesson is a failure.",
  "R3. Never emit 3 text blocks in a row. Break prose with a visual.",
  "R4. First block is always `heading`. Last block is always exactly one `summary`.",
  "R5. Never repeat a point you already made.",
  "R6. Copy `type` exactly from the allowed list. Never invent a type.",
  "R7. If unsure of a visual's data shape, use `table` or `basic-diagram`.",
  "    Never guess syntax you are unsure of — a wrong diagram is worse than a simple one.",
  "",
  "==== LESSON SKELETON — follow this order ====",
  " 1  heading      the topic, 3-6 words",
  " 2  paragraph    what it is and why it matters, 2-3 sentences",
  " 3  VISUAL       the core idea, shown not told",
  " 4  paragraph    explain what that visual shows",
  " 5  VISUAL       a second angle — example, data, or process",
  " 6  paragraph or bullet — the steps, or a worked example",
  " 7  VISUAL       a third, only if the topic genuinely needs it",
  " 8  callout      the one thing to remember",
  " 9  summary      3-4 short points. Then STOP.",
  "",
  "==== CHOOSING THE VISUAL — by the SHAPE of the idea, never the subject ====",
  "  a process, steps, a cycle        -> flow or mermaid",
  "  two or more things compared      -> table",
  "  numbers, trends, proportions     -> chart",
  "  a hierarchy, parts of a whole    -> mindmap",
  "  events in time order             -> timeline",
  "  a maths relationship             -> formula",
  "  a function to plot               -> graph",
  "  shapes, angles, geometry         -> geometry",
  "  anything structural or labelled  -> basic-diagram",
  "Ask yourself: what SHAPE is this idea? Then pick the matching block.",
  "A chemistry process and a history process both get a `flow`.",
  "",
  "==== WHAT EACH SUBJECT NEEDS ====",
  "MATHS         formula for the relationship, geometry for shapes and angles,",
  "              graph to plot a function, table for worked values, chart for data.",
  "SCIENCE       formula for laws, flow for processes and cycles, basic-diagram for",
  "              apparatus and structure, chart for experimental data,",
  "              molecule for chemistry (simple molecules only), table to compare.",
  "SOCIAL SCIENCE timeline for anything with dates, map for places and regions,",
  "              mindmap for causes and effects, table to compare, flow for how",
  "              an event led to another.",
  "ENGLISH       mindmap for essay or plot structure, table to compare characters",
  "              or texts, bullet for devices and techniques, quote for extracts.",
  "",
  "Never leave a lesson without the visual its subject naturally wants.",
  "A history lesson with no timeline is incomplete. A geometry lesson with no",
  "geometry block is incomplete.",
  "",
  "NOTE: `figure` needs a real image URL. You cannot create images, so do not",
  "use `figure` unless an image URL was given to you. Use basic-diagram instead.",
  "",
  "==== VISUAL LIST (these satisfy R2) ====",
  "chart, basic-diagram, mermaid, flow, timeline, mindmap, table, graph,",
  "geometry, formula, image, figure, map, molecule, threed",
  "",
  "==== NEVER ====",
  "- Never emit only paragraphs.",
  "- Never emit more than one `summary`.",
  "- Never call the tool again after the `summary`.",
  "- Never put a wall of text in one block. Split it.",
  "- Never add a visual that teaches nothing. A decorative chart is worse than none.",
  "",
  EXPECTED_CATALOG,
  "",
  "For text/heading/admonition blocks pass simply `{ text: string }`.",
].join("\n");

const EXPECTED_OUTLINE = [
  "You plan visual lessons for a student aged 14-16 on an infinite canvas.",
  "Return ONLY a JSON array of slots. No prose, no explanation.",
  "Each slot: { slot: number, type: string, intent: string }.",
  "`intent` is a SHORT phrase describing what that slot teaches.",
  "7 to 9 slots. First slot type is `heading`. Last slot type is `summary`.",
  "Prefer visual types wherever the idea has a shape:",
  "  process/steps -> flow | comparison -> table | dates -> timeline",
  "  data -> chart | maths relationship -> formula | function -> graph",
  "  shapes/angles -> geometry | places -> map | parts/kinds -> mindmap",
].join("\n");

const EXPECTED_BATCH = [
  "You are Agabi, building a visual lesson for a student aged 14-16.",
  "You are given a numbered lesson plan. Fill EVERY slot by calling `emit_block`",
  "once per slot: pass that slot's number and its content in the shape shown.",
  "Text slots (heading, paragraph, bullet, callout, summary) pass `text`.",
  "Visual slots (chart, table, timeline, mindmap, formula, flow, graph, geometry…) pass `data`.",
  "Never write prose outside a tool call. Never skip a slot. Never repeat a slot.",
  "Match each slot's shape as closely as you can — a rough visual beats an empty one.",
  "",
  EXPECTED_TEACHING,
].join("\n");

const req = (r: Partial<TeachRequest> & { kind: TeachRequest["kind"] }): TeachRequest => ({
  topic: "",
  ...r,
});

describe("teachingStyle — exact mentor-contract text (pins every line)", () => {
  it("returns the 7-line contract verbatim", () => {
    expect(teachingStyle()).toBe(EXPECTED_TEACHING);
  });
});

describe("systemPrompt — exact, catalog inlined (pins every line + the \\n joins)", () => {
  it("returns the full system prompt verbatim, block catalog and all", () => {
    expect(systemPrompt()).toBe(EXPECTED_SYSTEM);
  });
  it("keeps the empty separator lines empty (kills ''→'Stryker was here!' on blank lines)", () => {
    // A blank line becoming non-blank would collapse these exact \n\n boundaries.
    expect(systemPrompt()).toContain(
      "Never write prose outside a tool call. Never announce what you are about to do.\n\n==== HARD RULES — verify every one before you stop ====",
    );
    expect(systemPrompt()).toContain(
      "- Never add a visual that teaches nothing. A decorative chart is worse than none.\n\n" +
        EXPECTED_CATALOG,
    );
    expect(systemPrompt()).toContain(
      EXPECTED_CATALOG + "\n\nFor text/heading/admonition blocks pass simply `{ text: string }`.",
    );
    expect(systemPrompt()).not.toContain("Stryker was here!");
  });
});

describe("outlineSystemPrompt — exact planner text", () => {
  it("returns the outline planner prompt verbatim", () => {
    expect(outlineSystemPrompt()).toBe(EXPECTED_OUTLINE);
  });
});

describe("batchSystemPrompt — exact, teachingStyle appended after a blank line", () => {
  it("returns the batch system prompt verbatim, mentor contract embedded", () => {
    expect(batchSystemPrompt()).toBe(EXPECTED_BATCH);
  });
});

describe("jsonSlotSystem / textStreamSystem — teachingStyle + the exact tail literal", () => {
  it("jsonSlotSystem appends the bare-JSON directive verbatim", () => {
    expect(jsonSlotSystem()).toBe(
      EXPECTED_TEACHING +
        "\nThen output ONLY a single JSON object matching the requested shape. No prose, no markdown code fences, no explanation. Just the JSON.",
    );
  });
  it("textStreamSystem appends the plain-prose directive verbatim", () => {
    expect(textStreamSystem()).toBe(
      EXPECTED_TEACHING +
        "\nWrite clear, correct prose for one block. No markdown, no headings, no bullet lists — just the sentences.",
    );
  });
});

describe("contextTail (via userPrompt) — optional-chain guards missing explanations", () => {
  it("appends the exact 'Earlier in this session…' tail joined by '; '", () => {
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

  it("explanations undefined → optional chain returns no tail, does NOT throw (kills the removed ?.)", () => {
    // Without `?.`, `context.explanations.length` throws a TypeError here.
    const ctx = { topic: "Osmosis", selectedRegionId: null } as unknown as TeachContext;
    expect(userPrompt(req({ kind: "lesson", topic: "Osmosis" }), ctx)).toBe("Teach the topic: Osmosis.");
  });
});

// ---------------------------------------------------------------------------
// EXHAUSTIVE map-value pins. The command→instruction map in userPrompt and the
// command→label map in regionTitle each have 9 entries, but the other suites
// only exercised 1–2 of them — so a StringLiteral mutant on any UNTESTED value
// (→"" or →"Stryker was here!") survived. Every value below is a HARDCODED
// literal transcribed from the source (§H1.2), asserted via exact `.toBe()`:
// change any single map value and exactly one of these assertions breaks.
// The fixed topic ("Energy") + no context keeps the surrounding template
// constant so ONLY the mapped value under test can move the string.
// ---------------------------------------------------------------------------

describe("userPrompt — every command-map instruction pinned exactly (kills each map-value StringLiteral)", () => {
  const suffix = " Topic: Energy. Produce a NEW short explanation region.";
  const cases: [string, string][] = [
    ["simpler", "Re-explain the current idea in much simpler terms."],
    ["harder", "Go deeper on the current idea for an advanced student."],
    ["example", "Give another concrete worked example of the current idea."],
    ["visual", "Explain the current idea primarily with a diagram/visual."],
    ["again", "Explain the current idea again from a fresh angle."],
    ["continue", "Continue from where the lesson left off with the next step."],
    ["why", "Explain WHY the current idea is true."],
    ["how", "Explain HOW the current idea works step by step."],
    ["whatif", "Explore what changes if we vary the current idea."],
  ];
  for (const [command, instr] of cases) {
    it(`command "${command}" → its exact mapped instruction, not the generic fallback`, () => {
      const out = userPrompt(req({ kind: "command", topic: "Energy", command }));
      expect(out).toBe(instr + suffix);
      // A mutated value ("" / "Stryker was here!") — or the ?? fallback firing —
      // would change this exact string, so pin the generic form is NOT produced:
      expect(out).not.toContain('Act on the command');
      expect(out).not.toContain("Stryker was here!");
    });
  }
});

describe("regionTitle — every command-map label pinned exactly (kills each label-value StringLiteral)", () => {
  const cases: [string, string][] = [
    ["simpler", "Simpler"],
    ["harder", "Deeper"],
    ["example", "Another example"],
    ["visual", "Visual"],
    ["again", "Another way"],
    ["continue", "Continued"],
    ["why", "Why"],
    ["how", "How"],
    ["whatif", "What if"],
  ];
  for (const [command, label] of cases) {
    it(`command "${command}" → its exact label, not the "Explanation" fallback`, () => {
      const out = regionTitle(req({ kind: "command", topic: "Energy", command }));
      expect(out).toBe(label);
      // The ?? "Explanation" fallback must NOT fire for a mapped command, and
      // an emptied/replaced value must not slip through:
      expect(out).not.toBe("Explanation");
      expect(out).not.toBe("Stryker was here!");
    });
  }
});
