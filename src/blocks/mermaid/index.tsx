import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { mermaidSample, mermaidSchema, type MermaidData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={200} />,
});

export const mermaidBlock = defineBlock<MermaidData>({
  type: "mermaid",
  label: "Diagram",
  category: "diagram",
  defaultSize: { w: 520, h: 260 },
  schema: mermaidSchema,
  Renderer,
  sample: mermaidSample,
});
