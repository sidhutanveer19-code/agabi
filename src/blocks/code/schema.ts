import { z } from "zod";

export const codeSchema = z.object({
  language: z.string().default("javascript"),
  code: z.string(),
});
export type CodeData = z.infer<typeof codeSchema>;

export const codeSample: CodeData = {
  language: "python",
  code: `def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

print(fib(10))  # 55`,
};
