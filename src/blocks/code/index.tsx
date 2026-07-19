import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { codeSample, codeSchema, type CodeData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={280} />,
});

export const codeBlock = defineBlock<CodeData>({
  type: "code",
  label: "Code",
  category: "code",
  defaultSize: { w: 620, h: 300 },
  schema: codeSchema,
  Renderer,
  sample: codeSample,
});
