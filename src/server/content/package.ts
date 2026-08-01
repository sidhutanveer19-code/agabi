import { createHash } from "node:crypto";
import type { GraphDump } from "@/server/knowledge/store/KnowledgeStore";

/**
 * The Agabi Knowledge Package (Stage 5) — a portable, restorable snapshot of a populated graph.
 *
 * Two properties make it useful rather than decorative:
 *
 * **Deterministic.** `mintId()` is time + randomness by design, so ids can never be *re-derived* on
 * the target machine. Determinism therefore lives in the serialisation, not the generation: rows
 * are sorted by id (`dumpAll`) and every object is written with CANONICAL key ordering, so two
 * exports of the same state are byte-identical and a round-trip diff is meaningful.
 *
 * **Id-preserving.** Import re-inserts the exported ids verbatim and never re-mints. Re-minting
 * would produce a graph that is isomorphic but not identical, and "the restored graph matches"
 * could then never be checked — only asserted.
 *
 * The package carries its own provenance (Source + SourceChunk, A2), so grounding is re-verifiable
 * on the target machine without shipping the original PDFs.
 */

export const PACKAGE_FORMAT = "agabi-knowledge-package@1";

/** The tables written to graph/ and provenance/, in restore order (dependencies first). */
export const GRAPH_TABLES = [
  "concepts",
  "contexts",
  "sources",
  "sourceChunks",
  "statements",
  "provenance",
  "conceptAliases",
  "conceptTags",
  "dependencyEdges",
  "compositionEdges",
  "reinforcementEdges",
  "teachingAssets",
  "assessmentItems",
  "itemConcepts",
  "programs",
  "programNodes",
  "mappings",
  "releases",
  "releaseMembers",
  "reviewEvents",
] as const satisfies readonly (keyof GraphDump)[];
export type GraphTable = (typeof GRAPH_TABLES)[number];

/** Tables that belong in provenance/ rather than graph/ — the "how do we know this" half. */
export const PROVENANCE_TABLES: readonly GraphTable[] = ["sources", "sourceChunks", "provenance"];

/**
 * Canonical JSON: object keys sorted recursively, Dates as ISO strings. Two structurally equal
 * values always produce the same string, which is what makes the per-file hash a real identity
 * rather than a hash of whatever key order the driver happened to return.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = canonicalise((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** One NDJSON line per row, canonical — diffable, streamable, and stable across exports. */
export function toNdjson(rows: unknown[]): string {
  return rows.map((r) => canonicalJson(r)).join("\n") + (rows.length ? "\n" : "");
}

export function fromNdjson<T>(text: string): T[] {
  return text.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as T);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  exportedAt: string;
  gitSha: string | null;
  schemaVersion: string; // prisma schema hash — a restore into a different schema is not a restore
  promptVersion: string; // what produced the knowledge
  models: string[]; // model ids seen in provenance
  dataset: { id: string; name: string; version: string; license: string; sources: number } | null;
  counts: Record<string, number>;
  files: { path: string; sha256: string; bytes: number; rows: number }[];
}

/** Row counts per table — the summary a restore checks itself against. */
export function countsOf(dump: GraphDump): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of GRAPH_TABLES) counts[table] = dump[table].length;
  return counts;
}

/**
 * Does a restored dump match the exported one? Compares canonical JSON per table, and reports the
 * FIRST differing row per table rather than a bare boolean — "they differ" is not a diagnosis.
 */
export interface DumpDiff {
  table: GraphTable;
  expected: number;
  actual: number;
  firstMismatch?: { index: number; expected: string; actual: string };
}

export function diffDumps(expected: GraphDump, actual: GraphDump): DumpDiff[] {
  const diffs: DumpDiff[] = [];
  for (const table of GRAPH_TABLES) {
    const a = expected[table] as unknown[];
    const b = actual[table] as unknown[];
    if (a.length !== b.length) {
      diffs.push({ table, expected: a.length, actual: b.length });
      continue;
    }
    for (let i = 0; i < a.length; i++) {
      const ea = canonicalJson(a[i]);
      const eb = canonicalJson(b[i]);
      if (ea !== eb) {
        diffs.push({ table, expected: a.length, actual: b.length, firstMismatch: { index: i, expected: ea, actual: eb } });
        break;
      }
    }
  }
  return diffs;
}

/** Fields that must come back as Date objects after a JSON round-trip, per table. */
export const DATE_FIELDS: Partial<Record<GraphTable, string[]>> = {
  concepts: ["createdAt"],
  statements: ["createdAt", "disputedAt"],
  provenance: ["extractedAt"],
  sources: ["ingestedAt", "publishedAt"],
  reviewEvents: ["createdAt"],
  releases: ["createdAt"],
};

export function reviveDates<T extends Record<string, unknown>>(rows: T[], fields: string[]): T[] {
  return rows.map((row) => {
    const out = { ...row } as Record<string, unknown>;
    for (const f of fields) if (typeof out[f] === "string") out[f] = new Date(out[f] as string);
    return out as T;
  });
}
