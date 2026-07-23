import { ollamaJSON } from "@/server/advisors/jsonFill";

/**
 * A JSON model call, injected into the extractors so they are testable offline and
 * provider-agnostic. The default binds to free, local Ollama (`ollamaJSON`) — free
 * providers only, never a paid key. A test passes a fake returning fixture JSON.
 */
export interface JsonInvoke {
  (system: string, user: string): Promise<{ raw: string; data: Record<string, unknown> }>;
}

/**
 * `.env.local` sets OLLAMA_BASE_URL to the OpenAI-compatible endpoint (…:11434/v1) because that is
 * what the provider layer speaks. Extraction uses Ollama's NATIVE /api/chat, so the /v1 suffix must
 * come off or every call 404s — a silent, total extraction failure.
 */
export function nativeOllamaBase(raw: string | undefined): string {
  return (raw ?? "http://localhost:11434").replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Extraction is pinned deterministic: same chunk + same model ⇒ same proposals, so re-ingest
 *  dedups by exact text and the golden-set comparison stays apples-to-apples. */
export const EXTRACTION_SAMPLING = { temperature: 0, seed: 7 } as const;

/** Per-call ceiling. A local model that stops producing tokens otherwise stalls the whole
 *  population run in silence — and a run that hangs is worse than one that fails, because nothing
 *  is reported. On timeout the call throws, the chapter is recorded failed with the reason, and it
 *  is NOT checkpointed, so a resume retries it. */
export const EXTRACTION_TIMEOUT_MS = 6 * 60_000;

export function ollamaInvoker(nativeBase: string, modelId: string, signal: AbortSignal, timeoutMs = EXTRACTION_TIMEOUT_MS): JsonInvoke {
  const base = nativeOllamaBase(nativeBase);
  return async (system, user) => {
    // Per CALL, not per run: one signal for a whole corpus would abort mid-chapter.
    const perCall = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const r = await ollamaJSON(base, modelId, system, user, perCall, EXTRACTION_SAMPLING);
    return { raw: r.raw, data: r.data };
  };
}
