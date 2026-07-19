import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { chartSample, chartSchema, type ChartData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={250} />,
});

export const chartBlock = defineBlock<ChartData>({
  type: "chart",
  label: "Chart",
  category: "data",
  defaultSize: { w: 560, h: 290 },
  schema: chartSchema,
  Renderer,
  sample: chartSample,
});
