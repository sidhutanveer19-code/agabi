import { z } from "zod";

export const mapSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number().default(3),
  markerLabel: z.string().optional(),
});
export type MapData = z.infer<typeof mapSchema>;

export const mapSample: MapData = { center: [2.3522, 48.8566], zoom: 4, markerLabel: "Paris" };
