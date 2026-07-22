import { randomBytes, createHash } from "node:crypto";

/**
 * Identity for the knowledge platform (architecture §18A, amendment A-1).
 *
 * The rule (§18A.1): an id is opaque, k-sortable, collision-resistant, meaningless,
 * and minted IN-PROCESS — never by a database default. Meaning lives in the mutable
 * `slug` and in tags, never in the id (§18A.2).
 *
 * The generator is A-1's: a millisecond timestamp prefix (base36, zero-padded so it
 * sorts lexically) + a random suffix. It is NOT cuid2 (an uninstalled npm package that
 * G6 forbids) and NOT `crypto.randomUUID()` (v4 — §18A.2 rejected it for losing
 * k-sortability). Guarded by `src/server/preflight.test.ts`.
 */

// 9 base36 chars holds Date.now() until the year ~5188 — padStart keeps every id the
// same width so string comparison is timestamp comparison. The random suffix breaks
// ties within a millisecond (uniqueness) but is arbitrary order (that is what the "k"
// in k-sortable concedes).
export function mintId(): string {
  return Date.now().toString(36).padStart(9, "0") + randomBytes(8).toString("hex");
}

/**
 * §18A.3 — a slug is human-readable, unique, and MUTABLE. It is never an FK target;
 * the `identity` invariant test enforces that. On rename the old slug survives as a
 * `ConceptAlias{kind: FORMER_NAME}` so links keep resolving (handled in concept.ts).
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * §18A.5 — two deliberate exceptions to opacity: `Context` and `SourceChunk` derive
 * identity FROM their content, because their identity IS their content. That is what
 * makes diff-based re-ingestion possible (§12.3). These live here so the one sha256
 * convention is shared; the canonical-JSON step for a Context is in context/canonical.ts.
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
