import { z } from "zod";

const vec2 = z.object({ x: z.number(), y: z.number() });
const size = z.object({ w: z.number(), h: z.number() });

export const blockSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: vec2,
  size,
  z: z.number(),
  data: z.unknown(),
});

export const regionSchema = z.object({
  id: z.string(),
  title: z.string(),
  position: vec2,
  size,
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

export const cameraSchema = z.object({ x: z.number(), y: z.number(), scale: z.number() });
