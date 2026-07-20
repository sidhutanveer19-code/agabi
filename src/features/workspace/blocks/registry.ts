import type { BlockDefinition } from "@/features/workspace/blocks/types";

/**
 * The block registry: a type→definition map. The renderer resolves blocks
 * through here, so adding a block type is a single `registerBlock(def)` call —
 * the engine never changes. This is also the seam future Phase-4 blocks
 * (Excalidraw, tldraw, React Flow, Mermaid, Monaco, 3D…) plug into.
 */
const registry = new Map<string, BlockDefinition>();

export function registerBlock<TData>(def: BlockDefinition<TData>): void {
  registry.set(def.type, def as unknown as BlockDefinition);
}

export function getBlockDefinition(type: string): BlockDefinition | undefined {
  return registry.get(type);
}

export function allBlockTypes(): string[] {
  return [...registry.keys()];
}

export function hasBlock(type: string): boolean {
  return registry.has(type);
}

/** Every registered definition (order = registration order). */
export function allBlockDefinitions(): BlockDefinition[] {
  return [...registry.values()];
}

/** Insertable blocks for the authoring palette (interactive + has a factory). */
export function paletteBlockDefinitions(): BlockDefinition[] {
  return [...registry.values()].filter((d) => d.interactive && typeof d.create === "function");
}
