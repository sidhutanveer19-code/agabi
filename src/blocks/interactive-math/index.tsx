import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { interactiveMathSample, interactiveMathSchema, type InteractiveMathData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={320} />,
});

export const interactiveMathBlock = defineBlock<InteractiveMathData>({
  type: "interactive-math",
  label: "Interactive math",
  category: "math",
  defaultSize: { w: 480, h: 340 },
  schema: interactiveMathSchema,
  Renderer,
  sample: interactiveMathSample,
});
