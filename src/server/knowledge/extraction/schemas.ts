import { z } from "zod";
import { STATEMENT_FORMS, REINFORCEMENT_TYPES } from "@/server/knowledge/types";

/**
 * The trust-boundary schemas (V1). Raw model output crosses into the platform ONLY by
 * `accept(advice, schema)` / `acceptEach(advice, elementSchema)` — anything that does not match is
 * discarded, and nothing partially valid is ever repaired into validity. These schemas forbid a
 * `trustLevel`/`verified` field by simply not having one: even if a model emits it, it is stripped,
 * so a producer can never assert its own trust (ADR-2).
 *
 * **Amendment A-6 — element-wise, not batch-wise.** Extraction arrays are unwrapped with
 * `acceptEach`, which keeps the valid elements and reports the rest. The old batch rule threw away
 * eight good statements because a ninth carried an invented `form`. See `advisors/advice.ts` for
 * the measurement that forced the change; the per-element check itself is unchanged.
 */

/**
 * An optional string that also tolerates an explicit `null`. Local models write `"subject": null`
 * rather than omitting the key, and under a bare `.optional()` that null failed the whole element —
 * silently costing the statement its concept link (A-5). Null means "not provided"; it is mapped to
 * absent, never invented.
 */
const optionalString = z.string().nullish().transform((v) => v ?? undefined);

export const RawEntitySchema = z.object({
  name: z.string().min(1),
  slug: optionalString,
  kind: optionalString,
  aliases: z.array(z.string()).nullish().transform((v) => v ?? undefined),
});

export const RawStatementSchema = z.object({
  form: z.enum(STATEMENT_FORMS),
  kind: z.string().min(1),
  text: z.string().min(1),
  quote: z.string().min(1),
  structure: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  subject: optionalString,
  predicate: optionalString,
  object: optionalString,
  objectLit: optionalString,
  contextDimensions: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? undefined),
});

export const RawDependencySchema = z.object({
  fromName: z.string().min(1),
  toName: z.string().min(1),
  classification: z.enum(["REQUIRES", "PART_OF", "REINFORCEMENT"]),
  type: z.enum(REINFORCEMENT_TYPES).nullish().transform((v) => v ?? undefined),
});

export const ProposalBatchSchema = z.object({
  chunkId: z.string().min(1),
  entities: z.array(RawEntitySchema),
  statements: z.array(RawStatementSchema),
  dependencies: z.array(RawDependencySchema),
});

export const RawAssetSchema = z.object({
  kind: z.enum(["MISCONCEPTION", "ANALOGY", "WORKED_EXAMPLE"]),
  conceptName: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const RawItemSchema = z.object({
  kind: z.enum(["MCQ", "SHORT", "NUMERIC"]),
  conceptName: z.string().min(1),
  prompt: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const RawEntitiesSchema = z.array(RawEntitySchema);
export const RawStatementsSchema = z.array(RawStatementSchema);
export const RawDependenciesSchema = z.array(RawDependencySchema);
export const RawAssetsSchema = z.array(RawAssetSchema);
export const RawItemsSchema = z.array(RawItemSchema);
