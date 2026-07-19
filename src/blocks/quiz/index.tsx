"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { color, font, radius } from "@/design-system/tokens";
import { Button } from "@/design-system/primitives/Button";
import { BlockCard } from "@/workspace/blocks/BlockCard";
import { defineBlock, type BlockRendererProps } from "@/workspace/blocks";

const schema = z.object({
  question: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  answerId: z.string(),
  explanation: z.string().optional(),
});
type Data = z.infer<typeof schema>;

const answerSchema = z.object({ choice: z.string().min(1, "Pick one") });
type Answer = z.infer<typeof answerSchema>;

function Renderer({ data }: BlockRendererProps<Data>) {
  const { register, handleSubmit, watch } = useForm<Answer>({
    resolver: zodResolver(answerSchema),
  });
  const [submitted, setSubmitted] = useState(false);
  const choice = watch("choice");
  const correct = submitted && choice === data.answerId;

  return (
    <BlockCard eyebrow="Quiz" accent={color.cyan}>
      <form onSubmit={handleSubmit(() => setSubmitted(true))}>
        <div style={{ fontSize: 16, color: color.inkBright, marginBottom: 12, fontFamily: font.sans }}>
          {data.question}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.options.map((o) => {
            const isAns = o.id === data.answerId;
            const picked = choice === o.id;
            const border =
              submitted && isAns
                ? color.green
                : submitted && picked && !isAns
                ? color.danger
                : picked
                ? color.violet2
                : color.border;
            return (
              <label
                key={o.id}
                className="ds-focus"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderRadius: radius.md,
                  border: `1px solid ${border}`,
                  background: picked ? "rgba(167,139,250,.08)" : color.surface,
                  color: color.ink,
                  cursor: submitted ? "default" : "pointer",
                  fontFamily: font.sans,
                  fontSize: 14,
                }}
              >
                <input type="radio" value={o.id} disabled={submitted} {...register("choice")} />
                {o.label}
              </label>
            );
          })}
        </div>
        {!submitted ? (
          <Button type="submit" variant="primary" style={{ marginTop: 12 }}>
            Check answer
          </Button>
        ) : (
          <div
            style={{
              marginTop: 12,
              color: correct ? color.green : color.orange,
              fontSize: 14,
              fontFamily: font.sans,
            }}
          >
            {correct ? "Correct! " : "Not quite. "}
            {data.explanation}
          </div>
        )}
      </form>
    </BlockCard>
  );
}

export const quizBlock = defineBlock<Data>({
  type: "quiz",
  label: "Quiz",
  category: "pedagogy",
  defaultSize: { w: 520, h: 220 },
  schema,
  Renderer,
  sample: {
    question: "Which gas do plants release during photosynthesis?",
    options: [
      { id: "co2", label: "Carbon dioxide" },
      { id: "o2", label: "Oxygen" },
      { id: "n2", label: "Nitrogen" },
    ],
    answerId: "o2",
    explanation: "Plants take in CO₂ and release O₂.",
  },
});
