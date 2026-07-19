import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { threeDSample, threeDSchema, type ThreeDData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={320} />,
});

export const threeDBlock = defineBlock<ThreeDData>({
  type: "three-d",
  label: "3D model",
  category: "rich",
  defaultSize: { w: 480, h: 340 },
  schema: threeDSchema,
  Renderer,
  sample: threeDSample,
});
