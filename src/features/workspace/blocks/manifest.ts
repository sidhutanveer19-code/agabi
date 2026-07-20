import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { lessonBlockDefinition, LESSON_BLOCK } from "@/features/workspace/blocks/lesson";
import { registerTextBlocks } from "@/features/workspace/blocks/text";
import { registerAdmonitionBlocks } from "@/features/workspace/blocks/admonition";
import { registerListBlocks } from "@/features/workspace/blocks/list";
import { registerMathBlocks } from "@/features/workspace/blocks/math";
import { registerDividerBlock } from "@/features/workspace/blocks/divider";
import { registerImageBlock } from "@/features/workspace/blocks/image";
import { registerTableBlock } from "@/features/workspace/blocks/table";
import { registerDiagramBlock } from "@/features/workspace/blocks/diagram";
// Phase 4 — advanced visualization blocks (lazy-loaded heavy libraries).
import { registerFlowBlock } from "@/features/workspace/blocks/flow";
import { registerMermaidBlock } from "@/features/workspace/blocks/mermaid";
import { registerExcalidrawBlock } from "@/features/workspace/blocks/excalidraw";
import { registerTldrawBlock } from "@/features/workspace/blocks/tldraw";
import { registerChartBlock } from "@/features/workspace/blocks/chart";
import { registerGraphBlock } from "@/features/workspace/blocks/graph";
import { registerMonacoBlock } from "@/features/workspace/blocks/monaco";
import { registerGeometryBlock } from "@/features/workspace/blocks/geometry";
import { registerMathfieldBlock } from "@/features/workspace/blocks/mathfield";
import { registerThreedBlock } from "@/features/workspace/blocks/threed";
import { registerPhysicsBlock } from "@/features/workspace/blocks/physics";
import { registerMoleculeBlock } from "@/features/workspace/blocks/molecule";
import { registerFigureBlock } from "@/features/workspace/blocks/figure";
import { registerMapBlock } from "@/features/workspace/blocks/map";
import { registerTimelineBlock } from "@/features/workspace/blocks/timeline";
import { registerMindmapBlock } from "@/features/workspace/blocks/mindmap";
import { registerVideoBlock } from "@/features/workspace/blocks/video";
import { registerAudioBlock } from "@/features/workspace/blocks/audio";
import { registerGalleryBlock } from "@/features/workspace/blocks/gallery";
import { registerDocumentBlock } from "@/features/workspace/blocks/document";
import { registerEmbedBlock } from "@/features/workspace/blocks/embed";

/**
 * Register the full block set once (idempotent, client-side).
 *
 * Phase 2: the transitional handwritten `lesson` board (present-only).
 * Phase 3: the 24 core educational blocks (text / list / math / media / data /
 * structure / diagram) — the "alphabet" a future AI composes lessons from.
 * Future Phase-4 blocks (Excalidraw, tldraw, React Flow, Mermaid, Monaco, 3D…)
 * add one more `register…()` call here; the engine never changes.
 */
export function registerWorkspaceBlocks(): void {
  if (!hasBlock(LESSON_BLOCK)) registerBlock(lessonBlockDefinition);
  registerTextBlocks();
  registerAdmonitionBlocks();
  registerListBlocks();
  registerMathBlocks();
  registerDividerBlock();
  registerImageBlock();
  registerTableBlock();
  registerDiagramBlock();
  // Phase 4 diagram libraries
  registerFlowBlock();
  registerMermaidBlock();
  registerExcalidrawBlock();
  registerTldrawBlock();
  // Phase 4 data / math / 3D / science / media
  registerChartBlock();
  registerGraphBlock();
  registerMonacoBlock();
  registerGeometryBlock();
  registerMathfieldBlock();
  registerThreedBlock();
  registerPhysicsBlock();
  registerMoleculeBlock();
  registerFigureBlock();
  registerMapBlock();
  registerTimelineBlock();
  registerMindmapBlock();
  registerVideoBlock();
  registerAudioBlock();
  registerGalleryBlock();
  registerDocumentBlock();
  registerEmbedBlock();
}
