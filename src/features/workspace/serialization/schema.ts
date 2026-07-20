import { z } from "zod";

/**
 * Zod schemas mirroring the workspace domain types. These are the trust boundary
 * for anything read back from disk (or a future backend): unknown JSON is parsed
 * through here before it becomes a live document, so corrupt data can never crash
 * the workspace.
 */

export const vec2Schema = z.object({ x: z.number(), y: z.number() });
export const sizeSchema = z.object({ w: z.number(), h: z.number() });

export const cameraSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number(),
});

export const blockSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: vec2Schema,
  size: sizeSchema,
  z: z.number(),
  data: z.unknown(),
});

export const regionSchema = z.object({
  id: z.string(),
  title: z.string(),
  position: vec2Schema,
  size: sizeSchema,
  blocks: z.array(blockSchema),
  createdAt: z.number(),
  accent: z.string().optional(),
});

export const workspaceDocSchema = z.object({
  id: z.string(),
  schemaVersion: z.number(),
  topic: z.string().optional(),
  regions: z.array(regionSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type WorkspaceDocInput = z.infer<typeof workspaceDocSchema>;
