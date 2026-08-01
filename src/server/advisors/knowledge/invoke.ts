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
 *  is reported. Distinct from a transient failure: a timeout is deliberate and is NOT retried. */
export const EXTRACTION_TIMEOUT_MS = 6 * 60_000;

/**
 * Transient-failure retry. A local Ollama drops connections for ordinary reasons — it evicts and
 * reloads a model when memory is tight, another client competes for it, a socket resets. Over a
 * ~46-hour corpus run those are certainties, not risks.
 *
 * Before this existed there was no retry anywhere in the call path, so a single `TypeError: fetch
 * failed` propagated out of the chunk loop and aborted the whole chapter. That is exactly how
 * NCERT Real Numbers died 49 minutes in: one blip, ~45 minutes of model work discarded, and a
 * resume that would pay the entire cost again.
 *
 * Retrying is SAFE here precisely because extraction is pinned to temperature 0: the same chunk
 * returns the same text, so an attempt that partially succeeded and one that succeeds on retry are
 * indistinguishable. There is nothing to make idempotent.
 */
export const RETRY_DELAYS_MS = [2_000, 8_000, 30_000] as const;

/** A failure worth retrying: the connection broke. NOT a timeout (deliberate) or an abort. */
export function isTransient(err: unknown): boolean {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return false;
  const text = `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)} ${
    err instanceof Error && err.cause ? String((err.cause as { code?: string }).code ?? err.cause) : ""
  }`;
  return /fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|socket hang up|network|502|503|504/i.test(text);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface InvokerOptions {
  timeoutMs?: number;
  /** Called before each retry so the caller can record it (R1 — a retry is not a silent event). */
  onRetry?: (info: { attempt: number; delayMs: number; error: string }) => void;
}

export function ollamaInvoker(
  nativeBase: string,
  modelId: string,
  signal: AbortSignal,
  opts: InvokerOptions = {},
): JsonInvoke {
  const base = nativeOllamaBase(nativeBase);
  const timeoutMs = opts.timeoutMs ?? EXTRACTION_TIMEOUT_MS;

  return async (system, user) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      // Per CALL, not per run: one signal for a whole corpus would abort mid-chapter. A fresh
      // timeout per attempt, so a retry gets a full budget rather than the remains of the last one.
      const perCall = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
      try {
        const r = await ollamaJSON(base, modelId, system, user, perCall, EXTRACTION_SAMPLING);
        return { raw: r.raw, data: r.data };
      } catch (err) {
        lastError = err;
        if (signal.aborted || !isTransient(err) || attempt === RETRY_DELAYS_MS.length) throw err;
        const delayMs = RETRY_DELAYS_MS[attempt];
        opts.onRetry?.({
          attempt: attempt + 1,
          delayMs,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
        await sleep(delayMs);
      }
    }
    throw lastError; // unreachable: the loop either returns or throws
  };
}
