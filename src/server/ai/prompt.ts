import type { TeachRequest, TeachContext } from "@contract/schemas";
import { BLOCK_TYPES, BLOCK_HINTS } from "@/server/ai/blockTypes";

/**
 * Lesson + command + question prompt templates. The model builds a lesson purely
 * by calling the `emit_block` tool — never by writing prose. Block shapes come from
 * BLOCK_HINTS (D1: structural guidance in the description).
 */
function blockCatalog(): string {
  const hints = Object.entries(BLOCK_HINTS).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  return `Available block types (call emit_block with one of these exact \`type\` values):\n${BLOCK_TYPES.join(", ")}\n\nShapes for the common ones (pass as \`data\`):\n${hints}`;
}

export function systemPrompt(): string {
  return [
    "You are Agabi, an expert teacher who builds visual lessons on an infinite canvas.",
    "You teach ENTIRELY by calling the `emit_block` tool — one call per block, in reading order.",
    "Never write prose outside a tool call. Never explain what you are about to do.",
    "",
    "Build a clear, well-paced lesson: open with a `heading`, then alternate short",
    "`paragraph` explanations with the RIGHT visual for the idea — a `formula` for maths,",
    "a `chart` for data, a `basic-diagram`/`mermaid` for relationships, a `bullet`/`numbered`",
    "list for steps, a `callout`/`tip` for the key insight — and close with a `summary`.",
    "",
    "CRITICAL: emit BETWEEN 6 AND 12 blocks TOTAL, then STOP. Never repeat a point.",
    "You MUST include at least one non-text visual block: a `formula` for ANY maths",
    "or science idea, and/or a `chart`/`basic-diagram`/`bullet` list where it fits.",
    "A lesson of only paragraphs is a failure. Always finish with exactly one `summary`",
    "block, and after it, STOP calling the tool. Keep each block tight and concrete.",
    "",
    blockCatalog(),
    "",
    "For text/heading/admonition blocks pass simply `{ text: string }`.",
    "Stop when the lesson is complete.",
  ].join("\n");
}

function contextTail(context: TeachContext | undefined): string {
  if (!context) return "";
  const prior = context.explanations?.length
    ? `\nEarlier in this session you explained: ${context.explanations.map((e) => e.title).join("; ")}.`
    : "";
  return prior;
}

export function userPrompt(request: TeachRequest, context?: TeachContext): string {
  const topic = request.topic?.trim() || "this idea";
  const tail = contextTail(context);

  if (request.kind === "question" && request.text) {
    return `The student asked: "${request.text.trim()}"\nAnswer it as a short, self-contained explanation region about ${topic}.${tail}`;
  }
  if (request.kind === "command" && request.command) {
    const map: Record<string, string> = {
      simpler: "Re-explain the current idea in much simpler terms.",
      harder: "Go deeper on the current idea for an advanced student.",
      example: "Give another concrete worked example of the current idea.",
      visual: "Explain the current idea primarily with a diagram/visual.",
      again: "Explain the current idea again from a fresh angle.",
      continue: "Continue from where the lesson left off with the next step.",
      why: "Explain WHY the current idea is true.",
      how: "Explain HOW the current idea works step by step.",
      whatif: "Explore what changes if we vary the current idea.",
    };
    const instr = map[request.command] ?? `Act on the command "${request.command}".`;
    return `${instr} Topic: ${topic}. Produce a NEW short explanation region.${tail}`;
  }
  return `Teach the topic: ${topic}.${tail}`;
}

/** Title for the streamed region (mirrors the frontend's expectations). */
export function regionTitle(request: TeachRequest): string {
  if (request.kind === "question" && request.text) return request.text.trim();
  if (request.kind === "command" && request.command) {
    const t: Record<string, string> = {
      simpler: "Simpler", harder: "Deeper", example: "Another example", visual: "Visual",
      again: "Another way", continue: "Continued", why: "Why", how: "How", whatif: "What if",
    };
    return t[request.command] ?? "Explanation";
  }
  return request.topic?.trim() || "Lesson";
}
