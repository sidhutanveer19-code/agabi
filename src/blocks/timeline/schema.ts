import { z } from "zod";

export const timelineSchema = z.object({
  items: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      content: z.string(),
      start: z.string(),
      end: z.string().optional(),
    })
  ),
});
export type TimelineData = z.infer<typeof timelineSchema>;

export const timelineSample: TimelineData = {
  items: [
    { id: 1, content: "Estates-General", start: "1789-05-05" },
    { id: 2, content: "Bastille falls", start: "1789-07-14" },
    { id: 3, content: "Rights of Man", start: "1789-08-26" },
    { id: 4, content: "Reign of Terror", start: "1793-09-05", end: "1794-07-28" },
    { id: 5, content: "Napoleon rises", start: "1799-11-09" },
  ],
};
