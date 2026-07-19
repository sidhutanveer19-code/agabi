import { z } from "zod";

export const kgSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), label: z.string() })),
  edges: z.array(
    z.object({ source: z.string(), target: z.string(), label: z.string().optional() })
  ),
});
export type KgData = z.infer<typeof kgSchema>;

export const kgSample: KgData = {
  nodes: [
    { id: "cell", label: "Cell" },
    { id: "chloro", label: "Chloroplast" },
    { id: "photo", label: "Photosynthesis" },
    { id: "glucose", label: "Glucose" },
    { id: "resp", label: "Respiration" },
    { id: "atp", label: "ATP" },
  ],
  edges: [
    { source: "cell", target: "chloro", label: "contains" },
    { source: "chloro", target: "photo", label: "site of" },
    { source: "photo", target: "glucose", label: "produces" },
    { source: "glucose", target: "resp", label: "fuels" },
    { source: "resp", target: "atp", label: "yields" },
  ],
};
