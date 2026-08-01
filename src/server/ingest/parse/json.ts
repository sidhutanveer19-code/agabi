import type { Doc } from "@/server/ingest/spans";
import { parseMarkdown } from "@/server/ingest/parse/markdown";

/**
 * JSON structured-source parser (W4). A generic, content-independent contract: a source is
 * `{ title?, blocks: [{ level?, heading?, text? }] }` (or a bare array of blocks). It is rendered
 * to canonical markdown and reused through `parseMarkdown`, so a JSON source flows through the
 * IDENTICAL discovery + chunk pipeline as a markdown one — no special-casing downstream.
 */
interface JsonBlock {
  level?: number;
  heading?: string;
  text?: string;
}
interface JsonDoc {
  title?: string;
  blocks?: JsonBlock[];
}

function jsonToMarkdown(input: unknown): string {
  const doc = (Array.isArray(input) ? { blocks: input } : input) as JsonDoc;
  const parts: string[] = [];
  if (doc.title) parts.push(`# ${doc.title}`);
  for (const b of doc.blocks ?? []) {
    if (b.heading) parts.push(`${"#".repeat(Math.min(Math.max(b.level ?? 2, 1), 6))} ${b.heading}`);
    if (b.text) parts.push(b.text);
  }
  return parts.join("\n\n") + "\n";
}

export function parseJson(raw: string, page = 1): Doc {
  return parseMarkdown(jsonToMarkdown(JSON.parse(raw)), page);
}
