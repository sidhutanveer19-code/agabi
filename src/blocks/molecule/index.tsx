import dynamic from "next/dynamic";
import { Skeleton } from "@/design-system/primitives/atoms";
import { defineBlock } from "@/workspace/blocks";
import { moleculeSample, moleculeSchema, type MoleculeData } from "./schema";

const Renderer = dynamic(() => import("./Renderer").then((m) => m.Renderer), {
  ssr: false,
  loading: () => <Skeleton h={320} />,
});

export const moleculeBlock = defineBlock<MoleculeData>({
  type: "molecule",
  label: "Molecule",
  category: "rich",
  defaultSize: { w: 480, h: 340 },
  schema: moleculeSchema,
  Renderer,
  sample: moleculeSample,
});
