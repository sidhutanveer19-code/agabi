import type { ComponentType } from "react";
import type { BlockInstance } from "@/features/workspace/types";

export interface BlockRendererProps<T = unknown> {
  block: BlockInstance<T>;
  data: T;
}

/**
 * A block definition binds a `type` string to a renderer. Phase 2 registers only
 * the foundational `text` block; Phase 3/4 educational blocks (equation, chart,
 * flow, …) register into this same map — the workspace hosts them generically.
 */
export interface BlockDefinition<T = unknown> {
  type: string;
  label: string;
  Renderer: ComponentType<BlockRendererProps<T>>;
}

const registry = new Map<string, BlockDefinition>();

export function registerBlock<T>(def: BlockDefinition<T>): void {
  registry.set(def.type, def as unknown as BlockDefinition);
}

export function getBlockDefinition(type: string): BlockDefinition | undefined {
  return registry.get(type);
}

export function allBlockTypes(): string[] {
  return [...registry.keys()];
}
