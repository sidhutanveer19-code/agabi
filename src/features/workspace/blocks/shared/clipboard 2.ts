import type { BlockInstance } from "@/features/workspace/types";

/**
 * In-app block clipboard (dev authoring). Holds a deep copy of a block so it can
 * be pasted as a new offset duplicate. Deliberately in-memory — copy/paste of
 * teaching blocks is a developer tool, not a student feature.
 */
let clip: BlockInstance | null = null;

export const blockClipboard = {
  copy(block: BlockInstance): void {
    clip = JSON.parse(JSON.stringify(block)) as BlockInstance;
  },
  get(): BlockInstance | null {
    return clip ? (JSON.parse(JSON.stringify(clip)) as BlockInstance) : null;
  },
  has(): boolean {
    return clip !== null;
  },
};
