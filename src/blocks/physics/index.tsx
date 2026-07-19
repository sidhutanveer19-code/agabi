import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { physicsSample, physicsSchema, type PhysicsData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={300} />,
});

export const physicsBlock = defineBlock<PhysicsData>({
  type: "physics",
  label: "Physics simulation",
  category: "rich",
  defaultSize: { w: 560, h: 320 },
  schema: physicsSchema,
  Renderer,
  sample: physicsSample,
});
