import { describe, it, expect } from "vitest";

import { buildHierarchy, discover } from "@/server/ingest/discovery/hierarchy";
import { GENERIC_PROFILE, type CurriculumProfile } from "@/server/ingest/discovery/profile";
import type { Doc } from "@/server/ingest/spans";
import type { HierarchyNode } from "@/server/ingest/discovery/types";
import type { RawSource } from "@/server/ingest/connector";

/**
 * buildHierarchy / discover — structural markdown-heading discovery.
 *
 * The module is PURE and deterministic (no prisma/db/network/clock), so there is no
 * I/O edge to fake — every assertion below exercises the REAL logic against real input
 * and names the EXACT output span/start/end/level/page it must produce. Branches under
 * test, each pinned tight enough to go red under a mutation:
 *   - per-LINE heading detection (not per-span) + the `offset += line.length + 1` math
 *   - the HEADING regex: 1-6 `#`, mandatory space, ≥1 title char; rejects `#nospace`,
 *     7 hashes, blank, mid-line `#`; leading indent trimmed, trailing ws stripped
 *   - `end` = next heading of equal-or-HIGHER rank's start (`<=`), else docEnd (`<`
 *     would over-run); the inner loop CONTINUES past a deeper heading
 *   - `docEnd = doc.length ? last.sourceRange[1] : 0` (empty-doc branch)
 *   - stack push/pop nesting: `>=` pops siblings/shallower (top-level), keeps deeper (child)
 *   - `profile.headingMap[level] ?? "topic"` fallback on a partial map
 *   - subject rules: gated by `subjectRules && heads.length`, FIRST match wins (break),
 *     no match → null
 *   - discover(): pickProfile ignores the source → always GENERIC_PROFILE
 */

/** Build one span; end offset = start + text length (contiguous with the ORIGINAL source). */
const sp = (text: string, start: number, page = 1): Doc[number] => ({
  text,
  sourceRange: [start, start + text.length] as [number, number],
  page,
});

/** Walk a strictly-nested chain via `.children[0]`, collecting each node in depth order. */
function chain(nodes: HierarchyNode[]): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  let cur: HierarchyNode | undefined = nodes[0];
  while (cur) {
    out.push(cur);
    cur = cur.children[0];
  }
  return out;
}

describe("buildHierarchy — single heading, exact mapping", () => {
  it("one level-1 heading → one 'chapter' node spanning start→docEnd, subject null", () => {
    const doc: Doc = [sp("# Chapter One", 0, 1)]; // len 13
    expect(buildHierarchy(doc, GENERIC_PROFILE)).toEqual({
      subject: null,
      profile: "generic",
      nodes: [{ level: "chapter", title: "Chapter One", span: [0, 13], page: 1, children: [] }],
    });
  });
});

describe("buildHierarchy — nesting, end-ranges & stack pop logic", () => {
  it("book→section→subsection→section: children nest, ends stop at next equal/higher heading", () => {
    // starts: 0, 13, 26, 37 (single-line spans, +1 source gaps); docEnd = 49
    const doc: Doc = [
      sp("# Book Title", 0, 1), // [0,12]  level1
      sp("## Section A", 13, 1), // [13,25] level2
      sp("### Sub A1", 26, 2), // [26,36] level3
      sp("## Section B", 37, 2), // [37,49] level2
    ];

    const res = buildHierarchy(doc, GENERIC_PROFILE);
    expect(res.subject).toBe(null);
    expect(res.profile).toBe("generic");
    expect(res.nodes).toHaveLength(1);

    const book = res.nodes[0];
    // level1 has NO later heading of rank ≤1 → end = docEnd (49), not truncated
    expect(book).toMatchObject({ level: "chapter", title: "Book Title", span: [0, 49], page: 1 });
    expect(book.children.map((c) => c.title)).toEqual(["Section A", "Section B"]);

    const [secA, secB] = book.children;
    // Section A ends where Section B (equal rank) starts — the inner loop CONTINUED past
    // the deeper Sub A1 (level 3 !≤ 2) then broke on Section B (level 2 ≤ 2).
    expect(secA).toMatchObject({ level: "section", title: "Section A", span: [13, 37], page: 1 });
    expect(secA.children).toHaveLength(1);
    expect(secA.children[0]).toEqual({
      level: "subsection",
      title: "Sub A1",
      span: [26, 37], // ends at Section B's start (level 2 ≤ 3)
      page: 2,
      children: [],
    });
    // Section B is the LAST heading → end = docEnd; it has no children.
    expect(secB).toEqual({ level: "section", title: "Section B", span: [37, 49], page: 2, children: [] });
  });

  it("two sibling level-1 headings → TWO top-level nodes (pop empties the stack)", () => {
    const doc: Doc = [sp("# Chapter A", 0, 1), sp("# Chapter B", 12, 2)]; // [0,11], [12,23]; docEnd 23
    expect(buildHierarchy(doc, GENERIC_PROFILE)).toEqual({
      subject: null,
      profile: "generic",
      nodes: [
        { level: "chapter", title: "Chapter A", span: [0, 12], page: 1, children: [] }, // ends at B's start
        { level: "chapter", title: "Chapter B", span: [12, 23], page: 2, children: [] }, // last → docEnd
      ],
    });
  });

  it("all six markdown levels nest 1→6; levels 4/5/6 all map to 'topic'", () => {
    const doc: Doc = [sp("# L1\n## L2\n### L3\n#### L4\n##### L5\n###### L6", 0, 7)]; // single span, len 44
    const res = buildHierarchy(doc, GENERIC_PROFILE);
    expect(res.nodes).toHaveLength(1); // strictly nested → single root

    const c = chain(res.nodes);
    expect(c.map((n) => n.level)).toEqual([
      "chapter",
      "section",
      "subsection",
      "topic",
      "topic",
      "topic",
    ]);
    expect(c.map((n) => n.title)).toEqual(["L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(c.map((n) => n.page)).toEqual([7, 7, 7, 7, 7, 7]);
    // starts advance by each line's own length+1; every node runs to docEnd (44)
    expect(c.map((n) => n.span)).toEqual([
      [0, 44],
      [5, 44],
      [11, 44],
      [18, 44],
      [26, 44],
      [35, 44],
    ]);
    expect(c[5].children).toEqual([]); // deepest node has no children
  });
});

describe("buildHierarchy — heading detection edge cases (regex + offset)", () => {
  it("rejects #nospace / 7-hashes / blank / mid-line #; picks only the real trailing heading", () => {
    // lines: "#nospace"(8) "####### Seven"(13) ""(0) "text # mid"(10) "# Real"(6)
    const doc: Doc = [sp("#nospace\n####### Seven\n\ntext # mid\n# Real", 0, 1)]; // len 41
    const res = buildHierarchy(doc, GENERIC_PROFILE);
    // exactly ONE heading survives, and its start proves the per-line offset accumulation
    expect(res.nodes).toEqual([
      { level: "chapter", title: "Real", span: [35, 41], page: 1, children: [] },
    ]);
  });

  it("leading indentation is trimmed and trailing whitespace stripped from the title", () => {
    const doc: Doc = [sp("   ## Indented Heading  ", 0, 5)]; // len 24
    expect(buildHierarchy(doc, GENERIC_PROFILE).nodes).toEqual([
      { level: "section", title: "Indented Heading", span: [0, 24], page: 5, children: [] },
    ]);
  });

  it("a heading on a LATER line of a span gets start = span.start + intra-span offset", () => {
    // "intro prose"(11) "## Heading Two"(14) "more text"(9); span starts at 100
    const doc: Doc = [sp("intro prose\n## Heading Two\nmore text", 100, 3)]; // len 36 → [100,136]
    expect(buildHierarchy(doc, GENERIC_PROFILE).nodes).toEqual([
      { level: "section", title: "Heading Two", span: [112, 136], page: 3, children: [] },
    ]);
  });
});

describe("buildHierarchy — empty & heading-less docs", () => {
  it("empty doc → docEnd 0, no nodes, subject null", () => {
    expect(buildHierarchy([], GENERIC_PROFILE)).toEqual({
      subject: null,
      profile: "generic",
      nodes: [],
    });
  });

  it("spans but zero headings → no nodes (docEnd computed but unused)", () => {
    const doc: Doc = [sp("just some prose\nmore prose", 0, 1)];
    expect(buildHierarchy(doc, GENERIC_PROFILE)).toEqual({
      subject: null,
      profile: "generic",
      nodes: [],
    });
  });
});

describe("buildHierarchy — headingMap fallback + subject rules", () => {
  const cbseLike: CurriculumProfile = {
    id: "cbse-test",
    name: "CBSE test",
    headingMap: { 1: "chapter", 2: "section" }, // 3–6 absent → `?? "topic"`
    subjectRules: [
      { pattern: /physics/i, subject: "Physics" },
      { pattern: /chemistry/i, subject: "Chemistry" },
    ],
  };

  it("missing headingMap level falls back to 'topic'; FIRST subject rule wins over a later match", () => {
    const doc: Doc = [sp("# Physics and Chemistry", 0, 1), sp("### Deep Topic", 24, 1)];
    // top title matches BOTH physics and chemistry, but physics is first → break wins.
    expect(buildHierarchy(doc, cbseLike)).toEqual({
      subject: "Physics",
      profile: "cbse-test",
      nodes: [
        {
          level: "chapter",
          title: "Physics and Chemistry",
          span: [0, 38],
          page: 1,
          children: [
            // level 3 has no map entry → the ?? "topic" fallback
            { level: "topic", title: "Deep Topic", span: [24, 38], page: 1, children: [] },
          ],
        },
      ],
    });
  });

  it("subject rules present but NO rule matches the top heading → subject stays null", () => {
    const doc: Doc = [sp("# History Overview", 0, 1)];
    expect(buildHierarchy(doc, cbseLike)).toEqual({
      subject: null,
      profile: "cbse-test",
      nodes: [{ level: "chapter", title: "History Overview", span: [0, 18], page: 1, children: [] }],
    });
  });

  it("subject rules present but ZERO headings → detection skipped (heads.length falsy), subject null", () => {
    const doc: Doc = [sp("no headings here", 0, 2)];
    expect(buildHierarchy(doc, cbseLike)).toEqual({
      subject: null,
      profile: "cbse-test",
      nodes: [],
    });
  });
});

describe("discover / pickProfile", () => {
  const source: RawSource = {
    kind: "book",
    title: "Some Book",
    publisher: "Pub",
    authority: "Auth",
    license: "CC0-1.0",
  };

  it("discover uses the generic profile regardless of source and equals buildHierarchy(doc, GENERIC)", () => {
    const doc: Doc = [sp("# Root", 0, 1)]; // len 6
    const res = discover(doc, source);
    expect(res).toEqual({
      subject: null,
      profile: "generic",
      nodes: [{ level: "chapter", title: "Root", span: [0, 6], page: 1, children: [] }],
    });
    expect(res).toEqual(buildHierarchy(doc, GENERIC_PROFILE));
  });

  it("a DIFFERENT source kind still yields the generic profile (pickProfile ignores the source)", () => {
    const doc: Doc = [sp("# Anything", 0, 1)];
    const web: RawSource = { ...source, kind: "web", uri: "https://x.example" };
    expect(discover(doc, web).profile).toBe("generic");
  });
});
