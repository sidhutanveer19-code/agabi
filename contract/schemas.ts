import { z } from "zod";

/**
 * Agabi API contract — canonical schemas.
 *
 * This directory is the SHARED interface between the frontend and the backend.
 * It contains only data shapes, endpoints, stream events, and transport rules —
 * NO business logic, NO rendering, NO backend behaviour. Both repositories
 * implement against these types; neither owns them.
 */

// ---- Teaching ----

export const teachStatusSchema = z.enum([
  "idle",
  "thinking",
  "planning",
  "generating",
  "visualizing",
  "finished",
  "retrying",
  "cancelled",
  "error",
]);
export type TeachStatus = z.infer<typeof teachStatusSchema>;

export const teachRequestSchema = z.object({
  kind: z.enum(["lesson", "command", "question"]),
  topic: z.string(),
  command: z.string().optional(),
  text: z.string().optional(),
  // Region-focus seam: act on the region in view instead of re-teaching the topic.
  focusRegionId: z.string().optional(),
  priorContent: z.string().optional(),
});
export type TeachRequest = z.infer<typeof teachRequestSchema>;

/**
 * A block the backend decided to teach with. `type` names a registered frontend
 * block; `data` is that block's payload (opaque to transport). `streamText`, if
 * present, is filled in token-by-token via `patch` events. Note: NO layout
 * geometry (height/position) — that is a frontend rendering concern.
 */
export const streamedBlockSchema = z.object({
  type: z.string(),
  data: z.unknown(),
  streamText: z.string().optional(),
});
export type StreamedBlock = z.infer<typeof streamedBlockSchema>;

/**
 * One event in the `/teach` NDJSON stream. `v` is the wire version (B2) — additive
 * and optional so the frozen frontend ignores it; the server stamps `v:1` on every
 * event. Future shape changes bump `v` instead of breaking silently.
 */
export const teachEventSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("status"), v: z.literal(1).optional(), status: teachStatusSchema }),
  z.object({ t: z.literal("region"), v: z.literal(1).optional(), title: z.string() }),
  z.object({ t: z.literal("block"), v: z.literal(1).optional(), block: streamedBlockSchema }),
  z.object({ t: z.literal("patch"), v: z.literal(1).optional(), index: z.number(), data: z.unknown() }),
  z.object({ t: z.literal("done"), v: z.literal(1).optional() }),
  z.object({ t: z.literal("error"), v: z.literal(1).optional(), recoverable: z.boolean(), message: z.string() }),
]);
export type TeachEvent = z.infer<typeof teachEventSchema>;

/** Context the frontend sends so the backend can teach in-context (read-only to it). */
export const teachContextSchema = z.object({
  topic: z.string(),
  explanations: z.array(z.object({ regionId: z.string(), title: z.string(), kind: z.string() })),
  selectedRegionId: z.string().nullable(),
});
export type TeachContext = z.infer<typeof teachContextSchema>;

export const teachBodySchema = z.object({ request: teachRequestSchema, context: teachContextSchema });
export type TeachBody = z.infer<typeof teachBodySchema>;

// ---- Workspace persistence ----

const vec2 = z.object({ x: z.number(), y: z.number() });
const size = z.object({ w: z.number(), h: z.number() });

export const cameraSchema = z.object({ x: z.number(), y: z.number(), scale: z.number() });
export type Camera = z.infer<typeof cameraSchema>;

export const workspaceBlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: vec2,
  size,
  z: z.number(),
  data: z.unknown(),
});
export const workspaceRegionSchema = z.object({
  id: z.string(),
  title: z.string(),
  position: vec2,
  size,
  blocks: z.array(workspaceBlockSchema),
  createdAt: z.number(),
  accent: z.string().optional(),
});
export const workspaceDocSchema = z.object({
  id: z.string(),
  schemaVersion: z.number(),
  topic: z.string().optional(),
  regions: z.array(workspaceRegionSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type WorkspaceDoc = z.infer<typeof workspaceDocSchema>;

/** The full persisted workspace envelope (doc + camera). */
export const workspaceStateSchema = z.object({ doc: workspaceDocSchema, camera: cameraSchema });
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;

// ---- Observation events ----

export const studentEventSchema = z.object({
  type: z.string(), // e.g. topic_opened, lesson_started, lesson_completed, command, question, pan, zoom, selection
  ts: z.number(),
  workspaceId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type StudentEvent = z.infer<typeof studentEventSchema>;

export const eventsBodySchema = z.object({ events: z.array(studentEventSchema) });
export type EventsBody = z.infer<typeof eventsBodySchema>;

// ---- Session ----

export const sessionSchema = z.object({
  student: z.object({ id: z.string(), name: z.string().optional() }),
  preferences: z.record(z.string(), z.unknown()).optional(),
});
export type Session = z.infer<typeof sessionSchema>;

// ---- Errors ----

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
