/**
 * Learning Workspace — core domain types.
 *
 * The workspace is an infinite spatial surface. Every future lesson, explanation,
 * and educational block lives here. These types are deliberately domain-agnostic:
 * nothing below knows about physics, math, or any subject — only regions, blocks,
 * positions, and a camera.
 */

/** A point in a coordinate space (world or screen). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Width/height in a coordinate space. */
export interface Size {
  w: number;
  h: number;
}

/** Axis-aligned rectangle (origin + size), used for culling + fitting. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The viewport onto the infinite world.
 * `x`/`y` are the screen-pixel translation of the world origin; `scale` is zoom.
 */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/**
 * One hosted object on the canvas. Generic over its `data` payload so future
 * block types (text, equation, chart, 3d, code…) plug in without changing this
 * contract. `position`/`size` are in REGION-LOCAL coordinates.
 */
export interface BlockInstance<TData = unknown> {
  id: string;
  /** Registry key — resolves to a BlockDefinition at render time. */
  type: string;
  position: Vec2;
  size: Size;
  /** Stacking order within the region. */
  z: number;
  data: TData;
}

/**
 * A Region is one explanation area: a titled cluster of blocks placed in WORLD
 * space. The multiple-explanation model appends regions and never overwrites —
 * "explain it differently" creates a NEW region beside the old one.
 */
export interface Region {
  id: string;
  title: string;
  /** World-space top-left of the region. */
  position: Vec2;
  size: Size;
  blocks: BlockInstance[];
  /** ms epoch — creation order (append-only). */
  createdAt: number;
  /** Optional accent color (subject tint); falls back to a default. */
  accent?: string;
}

/**
 * The serializable workspace document. Everything needed to restore a student's
 * long-term learning environment exactly. `schemaVersion` guarantees old data is
 * always readable via migrations.
 */
export interface WorkspaceDoc {
  id: string;
  schemaVersion: number;
  /** The topic the student entered (seeds the first explanation). */
  topic?: string;
  regions: Region[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Current on-disk schema version. Persistence keys are namespaced by this value,
 * so bumping it orphans older workspace data (which is then never loaded).
 * v2: real `lesson` block. v3: Phase-3 core educational blocks (new data shapes).
 */
export const SCHEMA_VERSION = 3;
