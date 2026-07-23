import { z } from "zod";
import { readFileSync } from "node:fs";
import type { GoldenTruth } from "@/server/knowledge/extraction/golden";

/**
 * Golden-dataset framework (W6, gap D). The scorer (`scoreExtraction`) and the runner (`scoreRun`,
 * W3) already exist; what was missing is the authoring/validation machinery: a schema every golden
 * must satisfy, and a loader that rejects a malformed one. Humans author goldens later — this builds
 * the framework, never the thousands of datasets. A golden is a hand-authored ground truth (a set of
 * SPO triples) a chapter is scored against.
 */
export const GoldenTruthSchema = z.object({
  statements: z
    .array(
      z.object({
        subject: z.string().min(1),
        predicate: z.string().min(1),
        object: z.string().min(1),
      }),
    )
    .min(1),
});

/** Validate authored golden data against the contract (throws on any violation). */
export function validateGolden(raw: unknown): GoldenTruth {
  return GoldenTruthSchema.parse(raw);
}

/** Load + validate a golden file from disk. */
export function loadGolden(path: string): GoldenTruth {
  return validateGolden(JSON.parse(readFileSync(path, "utf8")));
}
