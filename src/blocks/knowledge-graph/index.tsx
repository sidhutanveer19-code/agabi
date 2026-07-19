import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { kgSample, kgSchema, type KgData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={340} />,
});

export const knowledgeGraphBlock = defineBlock<KgData>({
  type: "knowledge-graph",
  label: "Knowledge graph",
  category: "diagram",
  defaultSize: { w: 640, h: 360 },
  schema: kgSchema,
  Renderer,
  sample: kgSample,
});
