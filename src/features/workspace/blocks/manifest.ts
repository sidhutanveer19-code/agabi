import { registerBlock } from "./registry";
import { textBlock } from "./text";

let registered = false;

/** Register the Phase 2 block set (just the foundational `text` block). */
export function registerWorkspaceBlocks(): void {
  if (registered) return;
  registered = true;
  registerBlock(textBlock);
}
