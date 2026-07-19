import type { BlockDefinition, BlockType } from "./types";

const registry = new Map<BlockType, BlockDefinition>();

export function registerBlock<T>(def: BlockDefinition<T>): void {
  registry.set(def.type, def as unknown as BlockDefinition);
}

export function getBlock(type: BlockType): BlockDefinition | undefined {
  return registry.get(type);
}

export function allBlocks(): BlockDefinition[] {
  return [...registry.values()];
}

export function hasBlock(type: BlockType): boolean {
  return registry.has(type);
}
