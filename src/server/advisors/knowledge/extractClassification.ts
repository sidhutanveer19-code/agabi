import { advise, type Advice } from "@/server/advisors/advice";
import { classificationPrompt, PARAGRAPH_LABELS, type ParagraphLabel } from "@/server/advisors/knowledge/prompts";
import type { JsonInvoke } from "@/server/advisors/knowledge/invoke";

/**
 * Pass 0 — paragraph classification (2b). A textbook chunk mixes canonical exposition with worked
 * examples, exercises, history and motivation, and they are not equally teachable: the concepts
 * worth extracting live in the canonical prose, while the props of a worked example ("Qutub Minar",
 * "a boy standing 15 m away") are the main source of junk concepts.
 *
 * Two design constraints, both from measurement:
 *
 *  · **Indexed, not free-form.** A "classify all paragraphs" prompt returned three labels for a
 *    seven-paragraph chunk and failed silently — the caller had no way to tell which three. The
 *    paragraphs are therefore numbered by CODE and the model must return the same index back, so a
 *    short or scrambled answer is detectable rather than silently misaligned.
 *  · **Advisory, never a filter.** The label is threaded into the extraction prompts as context.
 *    It never deletes a paragraph, because a mislabel would then delete real content invisibly —
 *    exactly the failure mode R1 exists to prevent.
 */

export interface ParagraphClassification {
  index: number;
  label: ParagraphLabel;
}

/** Split a chunk the same way the classifier and the caller must both see it. */
export function splitParagraphs(chunkText: string): string[] {
  return chunkText.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
}

export async function extractClassification(paragraphs: string[], invoke: JsonInvoke): Promise<Advice<unknown>> {
  const { system, user } = classificationPrompt(paragraphs);
  const { data } = await invoke(system, user);
  return advise((data as { paragraphs?: unknown }).paragraphs ?? []);
}

export interface ClassificationOutcome {
  labels: (ParagraphLabel | null)[]; // one slot per input paragraph; null = the model did not label it
  unlabelled: number[]; // indices the model skipped — reported, never guessed (R1)
  invalid: { index: number; value: string }[]; // labels outside the vocabulary
}

/**
 * Align the model's answer to the paragraphs by INDEX, not by position. Anything missing stays
 * `null` and is reported; nothing is inferred from ordering, because a shifted list would silently
 * attach every label to the wrong paragraph.
 */
export function alignLabels(count: number, raw: unknown): ClassificationOutcome {
  const labels: (ParagraphLabel | null)[] = new Array(count).fill(null);
  const invalid: { index: number; value: string }[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const { index, label } = entry as { index?: unknown; label?: unknown };
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= count) continue;
      if (typeof label !== "string") continue;
      const upper = label.toUpperCase();
      if ((PARAGRAPH_LABELS as readonly string[]).includes(upper)) labels[index] = upper as ParagraphLabel;
      else invalid.push({ index, value: label });
    }
  }

  return { labels, unlabelled: labels.map((l, i) => (l === null ? i : -1)).filter((i) => i >= 0), invalid };
}

/** The one-line hint threaded into the extraction prompts. Absent labels contribute nothing. */
export function labelHint(labels: (ParagraphLabel | null)[]): string {
  const known = labels.filter((l): l is ParagraphLabel => l !== null);
  if (known.length === 0) return "";
  const counts = new Map<ParagraphLabel, number>();
  for (const l of known) counts.set(l, (counts.get(l) ?? 0) + 1);
  const parts = [...counts].map(([l, n]) => `${n}×${l}`).join(", ");
  return `Passage composition: ${parts}. Concepts and assertions live in CANONICAL, PRINCIPLE and PROOF text; EXAMPLE, PROBLEM, QUESTION and STORY text contains props and specifics that are NOT concepts.`;
}
