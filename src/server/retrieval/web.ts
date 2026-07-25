import { env } from "@/env";
import { buildGroundedOutline, WEB_PROMPT_VERSION, type GroundPassage, type GroundedOutline } from "@/server/conversation/grounding";

/**
 * Phase 3 (amendment A-7): web fallback. When neither the knowledge graph nor the textbook covers a
 * topic, teach it from a web search — through the SAME shared lesson builder as RAG, marked untrusted
 * so the injection guard applies. Read + present only; never writes the graph (A-7 invariant).
 *
 * The search is an injectable seam (`WebSearch`) so the outline logic is testable in ISOLATION
 * (§H1) — unit tests pass a fake, the real Tavily adapter is only exercised live.
 */
export interface WebResult {
  title: string;
  url: string;
  content: string;
}
export type WebSearch = (query: string) => Promise<WebResult[]>;

const MAX_WEB = 4;

/**
 * Real web search via Tavily (free tier). FAIL-SAFE: no key, non-200, timeout, or parse error → `[]`,
 * so teaching falls back to the default lesson and the student never sees an error (Law 11). Secret
 * comes from env (Law 22).
 */
export const tavilySearch: WebSearch = async (query) => {
  const key = env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key, query, max_results: MAX_WEB, search_depth: "basic" }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: { title?: unknown; url?: unknown; content?: unknown }[] };
    return (data.results ?? [])
      .map((r) => ({ title: String(r.title ?? "the web"), url: String(r.url ?? ""), content: String(r.content ?? "") }))
      .filter((r) => r.content.trim().length > 0);
  } catch {
    return []; // network / timeout / parse → fall back, never surface to the student
  }
};

/** Turn web results into the same mentor lesson as RAG. Null when the web finds nothing usable. */
export async function webGroundedOutline(topic: string, search: WebSearch): Promise<GroundedOutline | null> {
  const results = await search(topic);
  const passages: GroundPassage[] = results
    .filter((r) => r.content.trim().length > 0)
    .map((r) => ({ text: r.content, title: r.title || r.url || "the web" }));
  return buildGroundedOutline(topic, passages, WEB_PROMPT_VERSION, { untrusted: true });
}
