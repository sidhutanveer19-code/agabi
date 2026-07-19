import { z } from "zod";

export const chartSchema = z.object({
  kind: z.enum(["line", "bar", "area"]).default("line"),
  xKey: z.string(),
  yKeys: z.array(z.string()),
  data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
});
export type ChartData = z.infer<typeof chartSchema>;

export const chartSample: ChartData = {
  kind: "line",
  xKey: "year",
  yKeys: ["temperature"],
  data: [
    { year: "1900", temperature: 13.8 },
    { year: "1950", temperature: 14.0 },
    { year: "1980", temperature: 14.3 },
    { year: "2000", temperature: 14.6 },
    { year: "2020", temperature: 15.0 },
  ],
};
