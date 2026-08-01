import type { TeachRequest, TeachContext } from "@contract/schemas";
import { BLOCK_TYPES, BLOCK_HINTS } from "@/server/conversation/blockTypes";

/**
 * Bump whenever ANY prompt in this file changes meaning — it rides on every lesson's
 * event `provenance`, so "which prompt produced this lesson" stays answerable and
 * prompt experiments stay conclusive (invariant 4). Semver-ish string; compare exactly.
 */
export const PROMPT_VERSION = "1.1.0"; // 1.1.0: mentor teaching contract (docs/TEACHING.md)

/**
 * The mentor teaching contract (docs/TEACHING.md), shared by EVERY fill path so all teaching —
 * grounded (RAG), web, or default — has one soul: teach understanding, never restate a definition.
 */
export function teachingStyle(): string {
  return [
    "TEACH LIKE A MENTOR, not a summarizer — build understanding and judgment, not recall.",
    "For each block, teach the MECHANISM: how and why it works, and why the obvious alternative FAILS —",
    "never the textbook definition. Do NOT restate or reword a definition.",
    "Lead with INTUITION: a mechanism-revealing everyday ANALOGY (factory, city, restaurant, an OS),",
    "never an empty one — understanding before vocabulary.",
    "Place the idea: when to USE it, when to AVOID it, and connect it to a REAL-WORLD example.",
    "Plain words for a 14–16 year old. Simple first, then depth. No hedging, no 'certainly'.",
  ].join("\n");
}

/**
 * Lesson + command + question prompt templates. The model builds a lesson purely
 * by calling `emit_text` / `emit_visual` — never by writing prose. Block shapes come from
 * BLOCK_HINTS (D1: structural guidance in the description).
 */
function blockCatalog(): string {
  const hints = Object.entries(BLOCK_HINTS).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  return `Available block types (pass one of these exact \`type\` values — text types via emit_text, visual types via emit_visual):\n${BLOCK_TYPES.join(", ")}\n\nShapes for the common ones (pass as \`data\`):\n${hints}`;
}

export function systemPrompt(): string {
  return [
    "You are Agabi. You build visual lessons on an infinite canvas for a student aged 14-16.",
    "You teach ONLY by calling tools. Text blocks (heading, paragraph, bullet, callout,",
    "summary) go through `emit_text`; visual blocks (formula, chart, table, diagram, …) go",
    "through `emit_visual`. One call per block, in reading order.",
    "Never write prose outside a tool call. Never announce what you are about to do.",
    "",
    "==== HARD RULES — verify every one before you stop ====",
    "R1. Emit 7 to 10 blocks total, then stop calling the tool.",
    "R2. At least 3 blocks MUST come from the VISUAL LIST. A text-only lesson is a failure.",
    "R3. Never emit 3 text blocks in a row. Break prose with a visual.",
    "R4. First block is always `heading`. Last block is always exactly one `summary`.",
    "R5. Never repeat a point you already made.",
    "R6. Copy `type` exactly from the allowed list. Never invent a type.",
    "R7. If unsure of a visual's data shape, use `table` or `basic-diagram`.",
    "    Never guess syntax you are unsure of — a wrong diagram is worse than a simple one.",
    "",
    "==== LESSON SKELETON — follow this order ====",
    " 1  heading      the topic, 3-6 words",
    " 2  paragraph    what it is and why it matters, 2-3 sentences",
    " 3  VISUAL       the core idea, shown not told",
    " 4  paragraph    explain what that visual shows",
    " 5  VISUAL       a second angle — example, data, or process",
    " 6  paragraph or bullet — the steps, or a worked example",
    " 7  VISUAL       a third, only if the topic genuinely needs it",
    " 8  callout      the one thing to remember",
    " 9  summary      3-4 short points. Then STOP.",
    "",
    "==== CHOOSING THE VISUAL — by the SHAPE of the idea, never the subject ====",
    "  a process, steps, a cycle        -> flow or mermaid",
    "  two or more things compared      -> table",
    "  numbers, trends, proportions     -> chart",
    "  a hierarchy, parts of a whole    -> mindmap",
    "  events in time order             -> timeline",
    "  a maths relationship             -> formula",
    "  a function to plot               -> graph",
    "  shapes, angles, geometry         -> geometry",
    "  anything structural or labelled  -> basic-diagram",
    "Ask yourself: what SHAPE is this idea? Then pick the matching block.",
    "A chemistry process and a history process both get a `flow`.",
    "",
    "==== WHAT EACH SUBJECT NEEDS ====",
    "MATHS         formula for the relationship, geometry for shapes and angles,",
    "              graph to plot a function, table for worked values, chart for data.",
    "SCIENCE       formula for laws, flow for processes and cycles, basic-diagram for",
    "              apparatus and structure, chart for experimental data,",
    "              molecule for chemistry (simple molecules only), table to compare.",
    "SOCIAL SCIENCE timeline for anything with dates, map for places and regions,",
    "              mindmap for causes and effects, table to compare, flow for how",
    "              an event led to another.",
    "ENGLISH       mindmap for essay or plot structure, table to compare characters",
    "              or texts, bullet for devices and techniques, quote for extracts.",
    "",
    "Never leave a lesson without the visual its subject naturally wants.",
    "A history lesson with no timeline is incomplete. A geometry lesson with no",
    "geometry block is incomplete.",
    "",
    "NOTE: `figure` needs a real image URL. You cannot create images, so do not",
    "use `figure` unless an image URL was given to you. Use basic-diagram instead.",
    "",
    "==== VISUAL LIST (these satisfy R2) ====",
    "chart, basic-diagram, mermaid, flow, timeline, mindmap, table, graph,",
    "geometry, formula, image, figure, map, molecule, threed",
    "",
    "==== NEVER ====",
    "- Never emit only paragraphs.",
    "- Never emit more than one `summary`.",
    "- Never call the tool again after the `summary`.",
    "- Never put a wall of text in one block. Split it.",
    "- Never add a visual that teaches nothing. A decorative chart is worse than none.",
    "",
    blockCatalog(),
    "",
    "For text/heading/admonition blocks pass simply `{ text: string }`.",
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

/** Ollama JSON path (B): force a bare JSON object for one visual slot. */
export function jsonSlotSystem(): string {
  return teachingStyle() + "\nThen output ONLY a single JSON object matching the requested shape. No prose, no markdown code fences, no explanation. Just the JSON.";
}
export function jsonSlotUser(topic: string, slot: { type: string; intent: string }): string {
  const shape = shapeHint(slot.type);
  return `Lesson topic: ${topic}.\nProduce the data for one ${slot.type} block that teaches: ${slot.intent}.\nReturn ONLY a JSON object with exactly this shape: ${shape || "{ ... }"}.`;
}

/** Ollama text-stream path (I): plain prose for one text slot, streamed. */
export function textStreamSystem(): string {
  return teachingStyle() + "\nWrite clear, correct prose for one block. No markdown, no headings, no bullet lists — just the sentences.";
}
export function textStreamUser(topic: string, slot: { type: string; intent: string }): string {
  const kind =
    slot.type === "heading" || slot.type === "subheading" ? "a short title, 3-6 words"
      : slot.type === "summary" ? "3-4 short sentences recapping the lesson"
        : slot.type === "callout" || slot.type === "tip" || slot.type === "warning" ? "one memorable sentence"
          : "2-3 clear sentences";
  return `Lesson topic: ${topic}.\nWrite ${kind} for this block, which teaches: ${slot.intent}.`;
}

/** Phase-1 planner prompt: the model returns an outline of slots, no content.
 *  Retained for SHADOW PLANNING (E) — the sampled background call reuses it. */
export function outlineSystemPrompt(): string {
  return [
    "You plan visual lessons for a student aged 14-16 on an infinite canvas.",
    "Return ONLY a JSON array of slots. No prose, no explanation.",
    "Each slot: { slot: number, type: string, intent: string }.",
    "`intent` is a SHORT phrase describing what that slot teaches.",
    "7 to 9 slots. First slot type is `heading`. Last slot type is `summary`.",
    "Prefer visual types wherever the idea has a shape:",
    "  process/steps -> flow | comparison -> table | dates -> timeline",
    "  data -> chart | maths relationship -> formula | function -> graph",
    "  shapes/angles -> geometry | places -> map | parts/kinds -> mindmap",
  ].join("\n");
}

/** Phase-3 filler prompt: the model fills ONE slot with its single tool. */
export function slotPrompt(topic: string, slot: { type: string; intent: string }, priorIntents: string[]): string {
  const prior = priorIntents.length
    ? `\nAlready covered in this lesson (do NOT repeat): ${priorIntents.join("; ")}.`
    : "";
  const shape = shapeHint(slot.type);
  const shapeLine = shape ? `\nExpected \`data\` shape: ${shape}.` : "";
  return `Lesson topic: ${topic}.\nFill this one block.\nBlock type: ${slot.type}.\nIt should teach: ${slot.intent}.${shapeLine}${prior}\nCall your single tool exactly once.`;
}

/** Simplified RUNG-3 attempt-2 prompt: the shape only, intent prose dropped. */
export function slotShapePrompt(slot: { type: string; intent: string }): string {
  const shape = shapeHint(slot.type);
  const shapeLine = shape ? ` Shape: ${shape}.` : "";
  return `Fill one ${slot.type} block about "${slot.intent}".${shapeLine} Call the tool once with the data.`;
}

/** BLOCK_HINTS is keyed by grouped labels (e.g. "heading/subheading"); resolve a
 *  single type to its hint string. */
export function shapeHint(type: string): string {
  if (BLOCK_HINTS[type]) return BLOCK_HINTS[type];
  const hit = Object.entries(BLOCK_HINTS).find(([k]) => k.split("/").includes(type) || k.includes(type));
  return hit?.[1] ?? "";
}

/** RUNG-1 system prompt for the single `emit_block` batch tool. */
export function batchSystemPrompt(): string {
  return [
    "You are Agabi, building a visual lesson for a student aged 14-16.",
    "You are given a numbered lesson plan. Fill EVERY slot by calling `emit_block`",
    "once per slot: pass that slot's number and its content in the shape shown.",
    "Text slots (heading, paragraph, bullet, callout, summary) pass `text`.",
    "Visual slots (chart, table, timeline, mindmap, formula, flow, graph, geometry…) pass `data`.",
    "Never write prose outside a tool call. Never skip a slot. Never repeat a slot.",
    "Match each slot's shape as closely as you can — a rough visual beats an empty one.",
    "",
    teachingStyle(),
  ].join("\n");
}

/**
 * RUNG-1 batch prompt: the whole plan in one message, each slot printed WITH its
 * expected data shape (only the 5–6 types this outline actually uses — cuts tokens
 * and shows the model exactly what each slot needs).
 */
export function batchPrompt(topic: string, outline: { slot: number; type: string; intent: string }[]): string {
  const lines = outline.map((s) => {
    const shape = shapeHint(s.type);
    const shapeLine = shape ? `\n     shape: ${shape}` : "";
    return `  slot ${s.slot} — ${s.type} — ${s.intent}${shapeLine}`;
  });
  return [
    `Lesson topic: ${topic}.`,
    `Fill EVERY slot below by calling emit_block once per slot — pass the slot number,`,
    `and the content (text blocks use \`text\`; visual blocks use \`data\` in the shape shown).`,
    `Do not repeat a slot. Stop once every slot is filled.`,
    ``,
    ...lines,
  ].join("\n");
}
