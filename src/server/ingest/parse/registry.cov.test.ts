import { describe, it, expect } from "vitest";

import {
  registerParser,
  hasParser,
  knownFormats,
  parseFormat,
  type Format,
  type StringParser,
} from "@/server/ingest/parse/registry";
import type { Doc } from "@/server/ingest/spans";

/**
 * Format parser registry (W4). Pure module — no I/O edge to fake — so nothing is mocked:
 * every branch is exercised with real input against the real built-in parsers.
 *
 * IMPORTANT — shared mutable state: `registerParser` mutates the module-level PARSERS map,
 * and there is no unregister. Vitest runs the `it`s in this file top-to-bottom in one worker,
 * so the ORDER below is load-bearing: every assertion that depends on the *pristine* registry
 * (the exact-four `knownFormats()`, the exact "known:" list in the not-found error) is placed
 * FIRST, before any `registerParser` call. Registration tests that follow use unique custom
 * keys ("csv", "aaa-plugin", "cov-*") and NEVER clobber a built-in, so they cannot corrupt an
 * earlier or later built-in assertion.
 *
 * Exported surface under test: registerParser, hasParser, knownFormats, parseFormat.
 * Branches: parseFormat's `!fn` (miss → throw) vs. hit; its `page = 1` default vs. explicit;
 * hasParser true vs. false; knownFormats' sort; the "pdf" slot that throws E8 on invocation.
 */

// The exact E8/G6 message the "pdf" slot surfaces via parsePdf (two concatenated literals).
const PDF_E8_MESSAGE =
  "PDF parsing needs a parser dependency (E8, deferred). Adding one is a stop-and-ask (G6); " +
  "until then, ingest PDFs as extracted markdown/HTML text via the local-filesystem connector.";

/** Run `fn`, return the thrown Error's message; fail loudly if it did NOT throw. */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the call to throw, but it returned normally");
}

// ---------------------------------------------------------------------------
// PRISTINE-REGISTRY tests — these run FIRST and must see the untouched map.
// ---------------------------------------------------------------------------

describe("knownFormats — pristine registry", () => {
  it("returns EXACTLY the four built-in formats, alphabetically sorted", () => {
    // Insertion order is markdown, html, json, pdf; a sorted result proves `.sort()` ran
    // (drop the sort and this becomes ["markdown","html","json","pdf"] and fails).
    expect(knownFormats()).toEqual(["html", "json", "markdown", "pdf"]);
  });

  it("returns a fresh array on each call (Object.keys is not a shared reference)", () => {
    const a = knownFormats();
    const b = knownFormats();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("hasParser — membership check (pristine)", () => {
  it("returns true for every built-in format", () => {
    expect(hasParser("markdown")).toBe(true);
    expect(hasParser("html")).toBe(true);
    expect(hasParser("json")).toBe(true);
    expect(hasParser("pdf")).toBe(true);
  });

  it("returns false for a format that was never registered", () => {
    expect(hasParser("xml")).toBe(false);
    expect(hasParser("")).toBe(false);
  });
});

describe("parseFormat — routing to the correct built-in parser (pristine)", () => {
  it("markdown → span-splitter: blank line separates blocks, ranges map back", () => {
    const raw = "a\n\nb";
    expect(parseFormat(raw, "markdown")).toEqual<Doc>([
      { text: "a", sourceRange: [0, 1], page: 1 },
      { text: "b", sourceRange: [3, 4], page: 1 },
    ]);
  });

  it("html → tag-stripping extractor (NOT the markdown parser): entities decoded, tags gone", () => {
    const raw = "<p>Hi &amp; bye</p>";
    // A single block spanning the whole original string (tags included in the range).
    expect(parseFormat(raw, "html")).toEqual<Doc>([
      { text: "Hi & bye", sourceRange: [0, raw.length], page: 1 },
    ]);
  });

  it("json → JSON-to-markdown reuse (NOT raw-as-markdown): title + block become two spans", () => {
    const raw = '{"title":"T","blocks":[{"text":"body"}]}';
    // jsonToMarkdown → "# T\n\nbody\n"; if it routed the raw JSON through parseMarkdown
    // directly it would be ONE span of the literal "{...}" text, not these two.
    expect(parseFormat(raw, "json")).toEqual<Doc>([
      { text: "# T", sourceRange: [0, 3], page: 1 },
      { text: "body", sourceRange: [5, 9], page: 1 },
    ]);
  });

  it("stamps an EXPLICIT page through the built-in parser", () => {
    expect(parseFormat("x", "markdown", 5)).toEqual<Doc>([
      { text: "x", sourceRange: [0, 1], page: 5 },
    ]);
  });

  it("defaults page to 1 through the built-in parser when omitted (default-param branch)", () => {
    expect(parseFormat("x", "markdown")).toEqual<Doc>([
      { text: "x", sourceRange: [0, 1], page: 1 },
    ]);
  });

  it('the "pdf" slot is registered yet throws the EXACT E8 error on invocation', () => {
    // The slot exists (declared plugin) …
    expect(hasParser("pdf")).toBe(true);
    // … but calling it runs `() => parsePdf(Buffer.alloc(0))`, which throws unconditionally.
    expect(messageOf(() => parseFormat("anything", "pdf"))).toBe(PDF_E8_MESSAGE);
    // The slot ignores raw/page — it refuses regardless of input.
    expect(messageOf(() => parseFormat("", "pdf", 3))).toBe(PDF_E8_MESSAGE);
  });

  it("throws the EXACT not-found error for an unregistered format (the `!fn` branch)", () => {
    // `known:` is rendered from knownFormats().join(", ") over the pristine map.
    expect(messageOf(() => parseFormat("x", "nope" as Format))).toBe(
      'no parser registered for format "nope" (known: html, json, markdown, pdf)',
    );
  });

  it("the not-found message lists the KNOWN formats, comma-joined and sorted", () => {
    const msg = messageOf(() => parseFormat("x", "zzz" as Format));
    expect(msg).toContain('no parser registered for format "zzz"');
    expect(msg).toContain("(known: html, json, markdown, pdf)");
  });
});

// ---------------------------------------------------------------------------
// MUTATING tests — from here on, registerParser adds custom keys. These use
// unique keys and never touch a built-in, so the pristine tests above are safe.
// ---------------------------------------------------------------------------

describe("registerParser — extends the open registry", () => {
  it("makes a brand-new format usable by hasParser and parseFormat (the `fn` hit branch)", () => {
    expect(hasParser("csv")).toBe(false); // absent before registration
    const csv: StringParser = (raw, page = 1) => [
      { text: `csv:${raw}`, sourceRange: [0, raw.length], page },
    ];
    registerParser("csv", csv);

    expect(hasParser("csv")).toBe(true);
    expect(parseFormat("x,y", "csv" as Format)).toEqual<Doc>([
      { text: "csv:x,y", sourceRange: [0, 3], page: 1 },
    ]);
  });

  it("knownFormats includes a newly registered key and stays sorted", () => {
    registerParser("aaa-plugin", () => []);
    const formats = knownFormats();
    expect(formats).toContain("aaa-plugin");
    expect(formats).toContain("markdown");
    // Result equals its own sorted copy → `.sort()` really ran (insertion order would differ).
    expect(formats).toEqual([...formats].sort());
    // "aaa-plugin" is lexicographically smallest → it must sit at index 0.
    expect(formats[0]).toBe("aaa-plugin");
  });

  it("passes (raw, page) straight through, defaulting page to 1 when omitted", () => {
    const calls: Array<[string, number | undefined]> = [];
    registerParser("cov-probe", (raw, page) => {
      calls.push([raw, page]);
      return [{ text: raw, sourceRange: [0, raw.length], page: page ?? 1 }];
    });

    parseFormat("R", "cov-probe" as Format); // page omitted → default 1
    parseFormat("R2", "cov-probe" as Format, 9); // explicit page 9

    expect(calls).toEqual([
      ["R", 1],
      ["R2", 9],
    ]);
  });

  it("registering the same format twice REPLACES the parser (last write wins)", () => {
    registerParser("cov-override", () => [{ text: "A", sourceRange: [0, 1], page: 1 }]);
    expect(parseFormat("in", "cov-override" as Format)).toEqual<Doc>([
      { text: "A", sourceRange: [0, 1], page: 1 },
    ]);

    registerParser("cov-override", () => [{ text: "B", sourceRange: [0, 1], page: 1 }]);
    expect(parseFormat("in", "cov-override" as Format)).toEqual<Doc>([
      { text: "B", sourceRange: [0, 1], page: 1 },
    ]);

    // It is a single map key, not a duplicated entry.
    expect(knownFormats().filter((f) => f === "cov-override")).toHaveLength(1);
  });
});
