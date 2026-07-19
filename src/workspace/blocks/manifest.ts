import { registerBlock } from "./registry";

/**
 * Central block registration. Each block's definition is imported and registered
 * here exactly once. Adding a block = one import + one registerBlock line.
 */
let done = false;

export function registerAllBlocks(): void {
  if (done) return;
  done = true;
  // Block registrations are appended here as blocks are implemented.
  void registerBlock;
}
