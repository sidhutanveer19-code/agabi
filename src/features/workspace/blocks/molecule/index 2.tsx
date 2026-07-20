"use client";

import dynamic from "next/dynamic";
import { z } from "zod";
import { Hexagon } from "lucide-react";
import type { BlockDefinition, BlockRendererProps } from "@/features/workspace/blocks/types";
import { registerBlock, hasBlock } from "@/features/workspace/blocks/registry";
import { BlockLoading } from "@/features/workspace/blocks/shared/BlockLoading";
import type { MoleculeData } from "@/features/workspace/blocks/molecule/Renderer";

// Heavy library (3Dmol.js / WebGL) — code-split, loaded only when a molecule block mounts.
const MoleculeRenderer = dynamic(() => import("@/features/workspace/blocks/molecule/Renderer"), {
  ssr: false,
  loading: () => <BlockLoading label="molecule…" />,
});

const schema = z.object({
  format: z.enum(["pdb", "sdf", "xyz", "mol"]),
  data: z.string(),
}) as z.ZodType<MoleculeData>;

function MoleculeBlock(props: BlockRendererProps<MoleculeData>) {
  return <MoleculeRenderer {...props} />;
}

export function registerMoleculeBlock(): void {
  if (hasBlock("molecule")) return;
  const def: BlockDefinition<MoleculeData> = {
    type: "molecule",
    label: "Molecule",
    category: "diagram",
    icon: Hexagon,
    version: 1,
    component: MoleculeBlock,
    schema,
    create: () => ({
      format: "xyz",
      data: [
        "3",
        "water",
        "O   0.00000   0.00000   0.00000",
        "H   0.75800   0.58600   0.00000",
        "H  -0.75800   0.58600   0.00000",
      ].join("\n"),
    }),
    defaultSize: { w: 460, h: 380 },
    interactive: true,
    resizable: true,
    keywords: ["molecule", "3dmol", "chemistry", "3d", "pdb", "sdf", "xyz", "mol", "structure", "atom"],
  };
  registerBlock(def);
}
