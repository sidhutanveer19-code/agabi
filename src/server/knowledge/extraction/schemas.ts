import { z } from "zod";
import { STATEMENT_FORMS, REINFORCEMENT_TYPES } from "@/server/knowledge/types";

/**
 * The trust-boundary schemas (V1). Raw model output crosses into the platform ONLY by
 * `accept(advice, schema)` — anything that does not match is discarded as a batch, never
 * partially trusted. These schemas forbid a `trustLevel`/`verified` field by simply not
 * having one: even if a model emits it, it is stripped, so a producer can never assert
 * its own trust (ADR-2).
 */

export const RawEntitySchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  kind: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});

export const RawStatementSchema = z.object({
  form: z.enum(STATEMENT_FORMS),
  kind: z.string().min(1),
  text: z.string().min(1),
  quote: z.string().min(1),
  structure: z.record(z.string(), z.unknown()),
  subject: z.string().optional(),
  predicate: z.string().optional(),
  object: z.string().optional(),
  objectLit: z.string().optional(),
  contextDimensions: z.record(z.string(), z.unknown()).optional(),
});

export const RawDependencySchema = z.object({
  fromName: z.string().min(1),
  toName: z.string().min(1),
  classification: z.enum(["REQUIRES", "PART_OF", "REINFORCEMENT"]),
  type: z.enum(REINFORCEMENT_TYPES).optional(),
});

export const ProposalBatchSchema = z.object({
  chunkId: z.string().min(1),
  entities: z.array(RawEntitySchema),
  statements: z.array(RawStatementSchema),
  dependencies: z.array(RawDependencySchema),
});

export const RawEntitiesSchema = z.array(RawEntitySchema);
export const RawStatementsSchema = z.array(RawStatementSchema);
export const RawDependenciesSchema = z.array(RawDependencySchema);
