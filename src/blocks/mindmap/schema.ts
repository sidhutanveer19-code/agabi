import { z } from "zod";

export const mindmapSchema = z.object({ markdown: z.string() });
export type MindmapData = z.infer<typeof mindmapSchema>;

export const mindmapSample: MindmapData = {
  markdown: `# Photosynthesis
## Inputs
- Sunlight
- Water
- Carbon dioxide
## Process
- Light reactions
- Calvin cycle
## Outputs
- Glucose
- Oxygen`,
};
