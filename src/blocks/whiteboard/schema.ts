import { z } from "zod";

export const whiteboardSchema = z.object({
  elements: z.array(z.unknown()).default([]),
  viewOnly: z.boolean().default(false),
});
export type WhiteboardData = z.infer<typeof whiteboardSchema>;

export const whiteboardSample: WhiteboardData = { elements: [], viewOnly: false };
