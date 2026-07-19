import { z } from "zod";

export const interactiveMathSchema = z.object({ kind: z.enum(["parabola"]).default("parabola") });
export type InteractiveMathData = z.infer<typeof interactiveMathSchema>;

export const interactiveMathSample: InteractiveMathData = { kind: "parabola" };
