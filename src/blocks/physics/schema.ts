import { z } from "zod";

export const physicsSchema = z.object({ bodies: z.number().min(1).max(30).default(8) });
export type PhysicsData = z.infer<typeof physicsSchema>;

export const physicsSample: PhysicsData = { bodies: 9 };
