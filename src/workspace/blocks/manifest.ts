import { registerBlock } from "./registry";
import type { BlockDefinition } from "./types";

import { headingBlock } from "@/blocks/heading";
import { textBlock } from "@/blocks/text";
import { markdownBlock } from "@/blocks/markdown";
import { calloutBlock } from "@/blocks/callout";
import { hintBlock } from "@/blocks/hint";
import { definitionBlock } from "@/blocks/definition";
import { comparisonBlock } from "@/blocks/comparison";
import { dividerBlock } from "@/blocks/divider";
import { sketchBlock } from "@/blocks/sketch";
import { equationBlock } from "@/blocks/equation";
import { chartBlock } from "@/blocks/chart";
import { tableBlock } from "@/blocks/table";
import { flowBlock } from "@/blocks/flow";
import { mermaidBlock } from "@/blocks/mermaid";
import { mindmapBlock } from "@/blocks/mindmap";
import { timelineBlock } from "@/blocks/timeline";
import { knowledgeGraphBlock } from "@/blocks/knowledge-graph";

/**
 * Central block registration. Adding a block = one import + one entry below.
 */
const BLOCKS: BlockDefinition[] = [
  headingBlock,
  textBlock,
  markdownBlock,
  calloutBlock,
  hintBlock,
  definitionBlock,
  comparisonBlock,
  dividerBlock,
  sketchBlock,
  equationBlock,
  chartBlock,
  tableBlock,
  flowBlock,
  mermaidBlock,
  mindmapBlock,
  timelineBlock,
  knowledgeGraphBlock,
] as unknown as BlockDefinition[];

let done = false;

export function registerAllBlocks(): void {
  if (done) return;
  done = true;
  for (const def of BLOCKS) registerBlock(def);
}
