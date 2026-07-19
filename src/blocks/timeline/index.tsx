import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { timelineSample, timelineSchema, type TimelineData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={300} />,
});

export const timelineBlock = defineBlock<TimelineData>({
  type: "timeline",
  label: "Timeline",
  category: "diagram",
  defaultSize: { w: 720, h: 320 },
  schema: timelineSchema,
  Renderer,
  sample: timelineSample,
});
