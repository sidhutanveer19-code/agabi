import { z } from "zod";

/**
 * Server-side validation schemas for the block types we meaningfully constrain
 * (D1). `.passthrough()` so model-supplied extras (e.g. chart xKey) survive to the
 * client. Everything not here is emitted as-is and caught by BlockErrorBoundary.
 * Grown from V6 fallback logs, not guessed up front.
 */
export const chartSchema = z
  .object({
    kind: z.enum(["bar", "line", "area", "pie", "scatter"]),
    series: z.array(z.object({ key: z.string(), color: z.string().optional() })).min(1),
    data: z.array(z.record(z.string(), z.union([z.number(), z.string()]))).min(1),
    xKey: z.string().optional(),
  })
  .passthrough();

export const tableSchema = z
  .object({
    headers: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())),
    colWidths: z.array(z.number()).optional(),
  })
  .passthrough();

export const listSchema = z
  .object({
    items: z.array(z.object({ id: z.string(), text: z.string(), checked: z.boolean().optional() })).min(1),
  })
  .passthrough();

export const mathSchema = z.object({ latex: z.string().min(1) }).passthrough();
