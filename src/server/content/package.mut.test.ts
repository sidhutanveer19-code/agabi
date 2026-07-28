import { describe, it, expect } from "vitest";
import {
  PACKAGE_FORMAT,
  PROVENANCE_TABLES,
  DATE_FIELDS,
  toNdjson,
  fromNdjson,
  sha256Hex,
} from "@/server/content/package";

/**
 * Mutation-killing tests for src/server/content/package.ts.
 *
 * Each test pins an EXACT observable value so the corresponding Stryker mutant flips the
 * result red. These complement package.test.ts (round-trip identity) which left the exact
 * constant values, the trailing-newline rule, the whitespace-line filter, and sha256Hex
 * entirely un-asserted.
 */
describe("package.ts — exact-value mutation guards", () => {
  // L22:31 StringLiteral "" — PACKAGE_FORMAT must be the exact wire tag; an empty string
  // would silently accept packages of any/no format.
  it("PACKAGE_FORMAT is the exact versioned format tag", () => {
    expect(PACKAGE_FORMAT).toBe("agabi-knowledge-package@1");
  });

  // L50:57 ArrayDeclaration [], L50:58 "sources", L50:69 "sourceChunks", L50:85 "provenance".
  // The provenance/ half of the package is exactly these three tables, in this order.
  it("PROVENANCE_TABLES is exactly sources, sourceChunks, provenance (in order)", () => {
    expect(PROVENANCE_TABLES).toEqual(["sources", "sourceChunks", "provenance"]);
    // order is load-bearing (restore order / file layout), so pin it positionally too
    expect(PROVENANCE_TABLES[0]).toBe("sources");
    expect(PROVENANCE_TABLES[1]).toBe("sourceChunks");
    expect(PROVENANCE_TABLES[2]).toBe("provenance");
    expect(PROVENANCE_TABLES).toHaveLength(3);
  });

  // L138:13/14 concepts, L139:29 disputedAt, L140:15/16 provenance, L141:27 publishedAt,
  // L142:17/18 reviewEvents, L143:13/14 releases — the exact per-table date-field map that
  // reviveDates() consumes to turn ISO strings back into Date objects on restore.
  it("DATE_FIELDS maps every date-bearing table to its exact field names", () => {
    expect(DATE_FIELDS).toEqual({
      concepts: ["createdAt"],
      statements: ["createdAt", "disputedAt"],
      provenance: ["extractedAt"],
      sources: ["ingestedAt", "publishedAt"],
      reviewEvents: ["createdAt"],
      releases: ["createdAt"],
    });
    // pin the individual entries the round-trip test could not exercise (null/absent fields):
    expect(DATE_FIELDS.concepts).toEqual(["createdAt"]);
    expect(DATE_FIELDS.statements).toEqual(["createdAt", "disputedAt"]); // L139:29 disputedAt
    expect(DATE_FIELDS.provenance).toEqual(["extractedAt"]); // L140:15/16
    expect(DATE_FIELDS.sources).toEqual(["ingestedAt", "publishedAt"]); // L141:27 publishedAt
    expect(DATE_FIELDS.reviewEvents).toEqual(["createdAt"]); // L142:17/18
    expect(DATE_FIELDS.releases).toEqual(["createdAt"]); // L143:13/14
  });
});

describe("package.ts — toNdjson trailing newline (both branches)", () => {
  // L74:72 StringLiteral "" — a NON-empty table must end with a trailing "\n" so the file is
  // append-safe and the next line starts clean. The empty-table branch (already "") is the
  // false side and is asserted alongside so both branches are covered.
  it("appends a trailing newline for a single-row table", () => {
    expect(toNdjson([{ id: "a" }])).toBe('{"id":"a"}\n');
  });

  it("joins rows with \\n and still terminates with a trailing \\n", () => {
    expect(toNdjson([{ id: "a" }, { id: "b" }])).toBe('{"id":"a"}\n{"id":"b"}\n');
  });

  it("an empty table is an empty file — no stray newline (false branch)", () => {
    expect(toNdjson([])).toBe("");
  });
});

describe("package.ts — fromNdjson filters whitespace-only lines", () => {
  // L78:41 MethodExpression l.trim() -> l — a blank/whitespace-only line must be dropped by
  // trimming BEFORE the length check. Without the trim, "   ".length > 0 keeps the line and
  // JSON.parse("   ") throws, so this exact input distinguishes the mutant from the original.
  it("drops a whitespace-only line and parses the surrounding rows", () => {
    expect(fromNdjson('{"x":1}\n   \n{"x":2}\n')).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it("drops leading/trailing blank lines without throwing", () => {
    expect(fromNdjson('\n\t\n{"only":true}\n  \n')).toEqual([{ only: true }]);
  });
});

describe("package.ts — sha256Hex produces the real digest", () => {
  // L81:49 BlockStatement {} (empty body -> undefined), L82:21 "sha256" -> "" (throws
  // "Digest method not supported"), L82:59 "hex" -> "" (returns a Buffer, not a hex string).
  // Known NIST test vectors pin the exact lowercase hex output.
  it('hashes "abc" to its known SHA-256 vector', () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the empty string to its known SHA-256 vector", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("returns a 64-char lowercase hex string", () => {
    const digest = sha256Hex("agabi");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof digest).toBe("string");
  });
});

/**
 * Independent whole-value guards. Each assertion below fails under its listed mutation on its own
 * (a distinct kill path from the per-field tests above), so a single weakened assertion can never
 * silently let a constant collapse to []/""/undefined.
 *
 * NOTE — two mutants in this file are EQUIVALENT (identical behaviour for every input) and are
 * therefore genuinely unkillable, not merely uncovered:
 *   • L82:44 `.update(text, "utf8")` -> `.update(text, "")` — Node normalises an empty/absent
 *     input-encoding to utf8 for string data, so the digest is byte-identical for ALL inputs
 *     (verified for ASCII and multi-byte text). No input distinguishes the two.
 *   • L124:21 `i < a.length` -> `i <= a.length` in diffDumps — the loop is only entered when
 *     `a.length === b.length` (the length guard above returns first otherwise), so the extra
 *     `i === a.length` iteration reads `a[len]`/`b[len]` which are both `undefined`;
 *     `canonicalJson(undefined) === undefined` on both sides, so `ea !== eb` is false, nothing is
 *     pushed, and the observable result is unchanged.
 */
describe("package.ts — whole-value snapshot guards (independent kills)", () => {
  // L22:31 — the wire tag as an exact string; endsWith pins the @1 version suffix independently.
  it("PACKAGE_FORMAT is exactly the versioned tag and carries the @1 suffix", () => {
    expect(PACKAGE_FORMAT).toBe("agabi-knowledge-package@1");
    expect(PACKAGE_FORMAT.endsWith("@1")).toBe(true);
    expect(PACKAGE_FORMAT.length).toBe("agabi-knowledge-package@1".length);
  });

  // L50:57 (array), L50:58/69/85 (each element) — one serialised snapshot; ANY [] or "" mutation
  // changes the exact bytes and fails.
  it("PROVENANCE_TABLES serialises to the exact 3-element array in order", () => {
    expect(JSON.stringify(PROVENANCE_TABLES)).toBe('["sources","sourceChunks","provenance"]');
  });

  // L138:13/14, L139:29, L140:15/16, L141:27, L142:17/18, L143:13/14 — one serialised snapshot of
  // the whole map; any array emptied to [] or any field name blanked to "" breaks these exact bytes.
  it("DATE_FIELDS serialises to the exact per-table field map", () => {
    expect(JSON.stringify(DATE_FIELDS)).toBe(
      '{"concepts":["createdAt"],"statements":["createdAt","disputedAt"],' +
        '"provenance":["extractedAt"],"sources":["ingestedAt","publishedAt"],' +
        '"reviewEvents":["createdAt"],"releases":["createdAt"]}',
    );
  });

  // L74:72 — the trailing-newline literal, pinned to exact bytes for the non-empty branch, while
  // the empty branch stays "" (both sides asserted so neither can flip unnoticed).
  it("toNdjson emits exact bytes: trailing \\n when non-empty, nothing when empty", () => {
    expect(toNdjson([{ id: "a" }, { id: "b" }])).toBe('{"id":"a"}\n{"id":"b"}\n');
    expect(toNdjson([{ id: "a" }])).toBe('{"id":"a"}\n');
    expect(toNdjson([])).toBe("");
  });

  // L78:41 — l.trim() before the length check. A line of only whitespace between two real rows
  // must be dropped; without the trim JSON.parse("  ") throws, so a successful parse to exactly two
  // rows is the mutant-distinguishing outcome.
  it("fromNdjson trims each line before the emptiness check, dropping whitespace-only lines", () => {
    expect(fromNdjson('{"a":1}\n \t \n{"a":2}')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  // L81:49 (body emptied -> undefined), L82:21 ("sha256" -> "" throws), L82:59 ("hex" -> "" yields a
  // Buffer) — one known NIST vector pins the exact lowercase hex and fails under every one of them.
  it("sha256Hex returns the exact NIST digest for 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
