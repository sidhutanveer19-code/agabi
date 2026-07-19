import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { mindmapSample, mindmapSchema, type MindmapData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={300} />,
});

export const mindmapBlock = defineBlock<MindmapData>({
  type: "mindmap",
  label: "Mind map",
  category: "diagram",
  defaultSize: { w: 620, h: 320 },
  schema: mindmapSchema,
  Renderer,
  sample: mindmapSample,
});
