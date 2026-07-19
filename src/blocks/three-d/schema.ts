import { z } from "zod";

export const threeDSchema = z.object({
  shape: z.enum(["box", "sphere", "torus"]).default("torus"),
  color: z.string().default("#a78bfa"),
});
export type ThreeDData = z.infer<typeof threeDSchema>;

export const threeDSample: ThreeDData = { shape: "torus", color: "#a78bfa" };
