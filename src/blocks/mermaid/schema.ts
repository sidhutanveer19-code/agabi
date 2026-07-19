import { z } from "zod";

export const mermaidSchema = z.object({ code: z.string() });
export type MermaidData = z.infer<typeof mermaidSchema>;

export const mermaidSample: MermaidData = {
  code: `graph TD
  L[Sunlight] --> C{Chloroplast}
  W[Water] --> C
  D[CO2] --> C
  C --> G[Glucose]
  C --> O[Oxygen]`,
};
