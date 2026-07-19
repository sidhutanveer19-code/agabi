import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { whiteboardSample, whiteboardSchema, type WhiteboardData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={360} />,
});

export const whiteboardBlock = defineBlock<WhiteboardData>({
  type: "whiteboard",
  label: "Whiteboard",
  category: "spatial",
  defaultSize: { w: 720, h: 380 },
  schema: whiteboardSchema,
  Renderer,
  sample: whiteboardSample,
});
