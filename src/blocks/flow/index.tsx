import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { flowSample, flowSchema, type FlowData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={300} />,
});

export const flowBlock = defineBlock<FlowData>({
  type: "flow",
  label: "Flowchart",
  category: "diagram",
  defaultSize: { w: 620, h: 320 },
  schema: flowSchema,
  Renderer,
  sample: flowSample,
});
