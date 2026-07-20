import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { BlockInstance } from "@/features/workspace/types";

/**
 * The rendering + authoring contract every block obeys. The renderer knows
 * nothing about a block's meaning — it looks a definition up by `type` and mounts
 * its `component`. This is what lets Text / Math / Table / Image / Diagram (and
 * future Phase-4 blocks) plug in without touching the engine.
 */

export type BlockCategory = "text" | "list" | "math" | "media" | "data" | "structure" | "diagram";

/** Icon component shape (lucide-react icons satisfy this). */
export type BlockIcon = ComponentType<{ size?: number | string; strokeWidth?: number }>;

export interface BlockRendererProps<TData = unknown> {
  block: BlockInstance<TData>;
  regionId: string;
  /** Selected (dev authoring only). */
  selected: boolean;
  /** True when the block is being edited in place (dev authoring only). */
  editing?: boolean;
  /** Patch this block's data. No-op in present mode. */
  onChange?: (data: TData) => void;
  /** Request edit mode (e.g. a block asks to start editing on interaction). */
  onRequestEdit?: () => void;
}

export interface BlockDefinition<TData = unknown> {
  /** Registry key stored on each BlockInstance.type. */
  type: string;
  /** Human label (palette / a11y). */
  label: string;
  /** The React component that renders (and, in dev, edits) this block. */
  component: ComponentType<BlockRendererProps<TData>>;

  // ---- metadata (optional; used by the palette + serialization) ----
  /** Grouping for the palette. */
  category?: BlockCategory;
  /** Palette icon. */
  icon?: BlockIcon;
  /** Data-shape version for this block type (future migrations). */
  version?: number;
  /** Zod schema validating this block's `data` on deserialize. */
  schema?: ZodType<TData>;
  /** Factory for a fresh block's default data (used by the insert palette). */
  create?: () => TData;
  /** Default size when created. */
  defaultSize?: { w: number; h: number };
  /** Selectable/editable in dev (vs present-only, e.g. the lesson board). */
  interactive?: boolean;
  /** Whether resize handles apply. */
  resizable?: boolean;
  /** Extra search terms for the palette. */
  keywords?: string[];
}
