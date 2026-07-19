import type { ComponentType, ReactNode } from "react";
import type { ZodType } from "zod";

/** Broad grouping used by the gallery + composer. */
export type BlockCategory =
  | "structure"
  | "text"
  | "pedagogy"
  | "math"
  | "data"
  | "diagram"
  | "code"
  | "media"
  | "spatial"
  | "rich";

/** Concrete block types are the registered keys (kept as a string for openness). */
export type BlockType = string;

export interface BlockLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BlockInstance<T = unknown> {
  id: string;
  type: BlockType;
  layout: BlockLayout;
  data: T;
}

export interface BlockRendererProps<T = unknown> {
  data: T;
  block: BlockInstance<T>;
}

export interface BlockDefinition<T = unknown> {
  type: BlockType;
  label: string;
  category: BlockCategory;
  icon?: ReactNode;
  defaultSize: { w: number; h: number };
  /** Validates untrusted (AI/composed) data at the boundary. */
  schema: ZodType<T>;
  /** Lazy React renderer — the ONLY place the wrapped library is imported. */
  Renderer: ComponentType<BlockRendererProps<T>>;
  /** Sample data for the gallery + visual regression. */
  sample: T;
}

/** A composed lesson: an ordered set of positioned blocks on the canvas. */
export interface WorkspaceDoc {
  id: string;
  topic: string;
  subject: string;
  blocks: BlockInstance[];
}

/** Identity helper that preserves the data type parameter for inference. */
export function defineBlock<T>(def: BlockDefinition<T>): BlockDefinition<T> {
  return def;
}
