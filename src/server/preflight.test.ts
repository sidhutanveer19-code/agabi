import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

/**
 * PREFLIGHT — every external thing the frozen Phase 2 documents mandate must
 * actually be available.
 *
 * Why this exists: the frozen blueprint asserts dependencies it never verified.
 * ADR-4 mandates `cuid2` (an npm package) while G6 forbids adding npm packages —
 * a contradiction that sat undetected until someone wrote an M0 plan and tripped
 * over it. A second one (`pg_trgm`, needed for search rung 3) was found only by
 * then going to look, and would otherwise have ambushed M6.
 *
 * §25's validation matrix maps every architectural decision to a guarding test.
 * ADR-4's listed guard is `identity` — but `identity` only asserts "no FK targets
 * a slug, no id is ever updated". Nothing asserted that the mandated generator
 * EXISTS. That hole is this file.
 *
 * Design note — why an explicit manifest rather than parsing the docs:
 * regex over prose produces false positives ("no *unified* Edge table" is not the
 * `unified` package; "they are *marked*, not guessed" is not `marked`). A test
 * that silently mis-detects is worse than no test. So MANDATED is hand-declared,
 * and two guards keep it honest:
 *   1. availability — each entry must actually resolve / be installed
 *   2. anti-rot — each entry must still be named in the frozen docs
 * Adding a new external dependency to the frozen docs REQUIRES adding it here.
 * That obligation is carried by the amendment clause, not by magic.
 */

const DOCS = join(process.cwd(), "docs", "phase-2", "FINAL");
const DOC_FILES = [
  "00-audit-and-foundations.md",
  "01-architecture.md",
  "02-operations-and-assurance.md",
  "BLUEPRINT.md",
];

type Mandated = {
  /** what the docs name */
  readonly name: string;
  /** how it is provided */
  readonly kind: "npm" | "node-builtin" | "pg-extension";
  /** the decision that mandates it */
  readonly mandatedBy: string;
  /** the earliest phase that needs it — i.e. when a miss becomes blocking */
  readonly requiredBy: string;
  /** literal string that must still appear in the frozen docs (anti-rot) */
  readonly citedAs: string;
};

/**
 * Everything the frozen documents require from outside our own source.
 * ADR-4 was amended from `cuid2` to `node:crypto` randomUUID — see the amendment
 * record in BLUEPRINT.md. randomUUID satisfies every property ADR-4 actually
 * requires (opaque, immutable, generated in-process, never DB-generated) with no
 * dependency, which is the only reading that satisfies G6 as well.
 */
const MANDATED: readonly Mandated[] = [
  { name: "@prisma/client", kind: "npm", mandatedBy: "L9 / §17", requiredBy: "M0", citedAs: "Prisma" },
  { name: "node:crypto", kind: "node-builtin", mandatedBy: "ADR-4 / A-1", requiredBy: "M0", citedAs: "randomBytes" },
  { name: "pg_trgm", kind: "pg-extension", mandatedBy: "§15 search rung 3", requiredBy: "M6", citedAs: "trigram" },
  // NOT listed: `zod`. It is installed and used across the codebase, but the frozen
  // Phase 2 documents never mandate it by name — so it is not one of *their* external
  // requirements. The anti-rot check caught this entry as unfounded. Left as a note
  // because "obviously it's required" is exactly the assumption this file exists to reject.
];

const docText = DOC_FILES.filter((f) => existsSync(join(DOCS, f)))
  .map((f) => readFileSync(join(DOCS, f), "utf8"))
  .join("\n");

const req = createRequire(import.meta.url);

describe("preflight — the frozen docs' external requirements exist", () => {
  it("finds the frozen documents (else every check below is vacuous)", () => {
    expect(docText.length).toBeGreaterThan(1000);
  });

  for (const m of MANDATED.filter((x) => x.kind === "npm")) {
    it(`${m.name} is installed — mandated by ${m.mandatedBy}, needed at ${m.requiredBy}`, () => {
      expect(() => req.resolve(m.name)).not.toThrow();
    });
  }

  for (const m of MANDATED.filter((x) => x.kind === "node-builtin")) {
    it(`${m.name} is available — mandated by ${m.mandatedBy}, needed at ${m.requiredBy}`, async () => {
      const mod = await import(m.name);
      expect(mod).toBeTruthy();
      if (m.name === "node:crypto") {
        // A-1: the generator must be opaque, unique AND k-sortable. k-sortability is
        // the property §18A.2 rejected UUIDv4 over — so it is the one worth asserting,
        // not merely "an id came out".
        const crypto = mod as typeof import("node:crypto");
        expect(typeof crypto.randomBytes).toBe("function");
        const mint = () =>
          Date.now().toString(36).padStart(9, "0") + crypto.randomBytes(8).toString("hex");

        // Uniqueness holds even within one millisecond — that is the random suffix's job.
        expect(mint()).not.toEqual(mint());

        // k-sortability is a property ACROSS time, not within a single tick: ids minted
        // in the same millisecond are ordered arbitrarily by their random suffix, which
        // is what the "k" in k-sortable means. Asserting strict order within one tick
        // would be asserting a property no timestamp+random scheme has, cuid2 included.
        const early = mint();
        await new Promise((r) => setTimeout(r, 3));
        const late = mint();
        expect(early < late, "ids minted later must sort later — k-sortable across time").toBe(true);
      }
    });
  }

  /**
   * Anti-rot: a manifest entry naming something the docs no longer mention is a
   * stale requirement, and stale requirements are how a manifest quietly stops
   * describing reality.
   */
  for (const m of MANDATED) {
    it(`${m.name} is still cited in the frozen docs (as "${m.citedAs}")`, () => {
      expect(docText.toLowerCase()).toContain(m.citedAs.toLowerCase());
    });
  }

  /**
   * G6 — no new npm dependency in M0–M9. Any npm entry above must predate Phase 2,
   * i.e. already be a declared dependency rather than something a phase installed.
   */
  it("G6 holds — every mandated npm package is already a declared dependency", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    const undeclared = MANDATED.filter((m) => m.kind === "npm" && !declared.has(m.name)).map((m) => m.name);
    expect(undeclared).toEqual([]);
  });

  /**
   * ADR-4 is amended. cuid2 must not creep back in as a mandate, because it is not
   * installed and G6 forbids installing it — the exact contradiction this file exists
   * to prevent recurring.
   */
  it("cuid2 is not mandated by the frozen docs (ADR-4 amended → A-1)", () => {
    // A mention is HISTORICAL if its own line marks it as amended/superseded, or if
    // the line sits inside the amendment record (blockquote). Anything else is a live
    // mandate — which is the contradiction this test exists to prevent recurring.
    const HISTORICAL = /amend|superseded|A-1|original choice|^>/i;
    const offenders: string[] = [];
    for (const f of DOC_FILES.filter((x) => existsSync(join(DOCS, x)))) {
      readFileSync(join(DOCS, f), "utf8")
        .split(/\n/)
        .forEach((line, i) => {
          if (/cuid2/i.test(line) && !HISTORICAL.test(line.trim())) offenders.push(`${f}:${i + 1}`);
        });
    }
    expect(offenders, "cuid2 is mandated here but is not installed, and G6 forbids installing it").toEqual([]);
  });
});

/**
 * Postgres extensions need a live database, which CI may not have. REGISTER these tests only when
 * DATABASE_URL is set (CI does) — a plain conditional, NOT a skip variant: with no DB there is
 * nothing to assert, and the checks above still run. Silently passing when the DB IS reachable but
 * the extension is missing would be wrong, so the assertions below stay strict.
 */
if (process.env.DATABASE_URL) describe("preflight — Postgres extensions", () => {
  for (const m of MANDATED.filter((x) => x.kind === "pg-extension")) {
    it(`${m.name} is enabled — mandated by ${m.mandatedBy}, needed at ${m.requiredBy}`, async () => {
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      try {
        const rows = await prisma.$queryRawUnsafe<{ installed_version: string | null }[]>(
          "select installed_version from pg_available_extensions where name = $1",
          m.name,
        );
        expect(rows.length, `${m.name} is not available on this server`).toBeGreaterThan(0);
        expect(
          rows[0].installed_version,
          `${m.name} is available but NOT enabled — run: CREATE EXTENSION ${m.name}; (human-gated, like db push). Blocking from ${m.requiredBy}.`,
        ).not.toBeNull();
      } finally {
        await prisma.$disconnect();
      }
    });
  }
});
