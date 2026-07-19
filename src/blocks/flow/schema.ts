import { z } from "zod";

export const flowSchema = z.object({
  nodes: z.array(
    z.object({ id: z.string(), label: z.string(), x: z.number(), y: z.number() })
  ),
  edges: z.array(
    z.object({ source: z.string(), target: z.string(), label: z.string().optional() })
  ),
});
export type FlowData = z.infer<typeof flowSchema>;

export const flowSample: FlowData = {
  nodes: [
    { id: "1", label: "Sunlight", x: 0, y: 20 },
    { id: "2", label: "Chloroplast", x: 210, y: 90 },
    { id: "3", label: "Glucose", x: 430, y: 0 },
    { id: "4", label: "Oxygen", x: 430, y: 170 },
  ],
  edges: [
    { source: "1", target: "2" },
    { source: "2", target: "3", label: "stored" },
    { source: "2", target: "4", label: "released" },
  ],
};
