/**
 * Core geometry + document types for the Agabi Learning Workspace.
 * Infrastructure only — blocks are hosted generically; no educational block
 * shapes live here.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pan offset (screen px) + zoom scale. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** A hosted block. `type` resolves to a renderer in the block registry. */
export interface BlockInstance<T = unknown> {
  id: string;
  type: string;
  /** Position relative to the parent region's origin, in world units. */
  position: Vec2;
  size: Size;
  /** Stacking order within the region (higher = front). */
  z: number;
  data: T;
}

/** One explanation. Regions are append-only and never overwritten. */
export interface Region {
  id: string;
  title: string;
  /** Top-left position in world coordinates. */
  position: Vec2;
  size: Size;
  blocks: BlockInstance[];
  /** Monotonic creation counter (passed in — no Date.now here). */
  createdAt: number;
  accent?: string;
}

export interface WorkspaceDoc {
  id: string;
  schemaVersion: number;
  topic?: string;
  regions: Region[];
  createdAt: number;
  updatedAt: number;
}

export const SCHEMA_VERSION = 1 as const;
