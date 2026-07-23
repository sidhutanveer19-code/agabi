import type { Doc } from "@/server/ingest/spans";
import { parseMarkdown } from "@/server/ingest/parse/markdown";
import { parseHtml } from "@/server/ingest/parse/html";
import { parseJson } from "@/server/ingest/parse/json";
import { parsePdf } from "@/server/ingest/parse/pdf";

/**
 * Format parser registry (W4). An open registry: a source format maps to a `raw → Doc` parser.
 * markdown/html/json are functional; **pdf is a declared plugin SLOT** — its entry throws the
 * E8/G6 deferred-dependency error until a real parser is registered with `registerParser("pdf", …)`.
 * Adding a format is a `registerParser` call, never an engine change.
 */
export type Format = "markdown" | "html" | "json" | "pdf";
export type StringParser = (raw: string, page?: number) => Doc;

const PARSERS: Record<string, StringParser> = {
  markdown: parseMarkdown,
  html: parseHtml,
  json: parseJson,
  // pdf: a slot. parsePdf throws the E8 deferred-dependency error (adding a PDF lib is stop-and-ask).
  pdf: () => parsePdf(Buffer.alloc(0)),
};

export function registerParser(format: string, fn: StringParser): void {
  PARSERS[format] = fn;
}
export function hasParser(format: string): boolean {
  return format in PARSERS;
}
export function knownFormats(): string[] {
  return Object.keys(PARSERS).sort();
}
export function parseFormat(raw: string, format: Format, page = 1): Doc {
  const fn = PARSERS[format];
  if (!fn) throw new Error(`no parser registered for format "${format}" (known: ${knownFormats().join(", ")})`);
  return fn(raw, page);
}
