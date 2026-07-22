import { ollamaJSON } from "@/server/advisors/jsonFill";

/**
 * A JSON model call, injected into the extractors so they are testable offline and
 * provider-agnostic. The default binds to free, local Ollama (`ollamaJSON`) — free
 * providers only, never a paid key. A test passes a fake returning fixture JSON.
 */
export interface JsonInvoke {
  (system: string, user: string): Promise<{ raw: string; data: Record<string, unknown> }>;
}

export function ollamaInvoker(nativeBase: string, modelId: string, signal: AbortSignal): JsonInvoke {
  return async (system, user) => {
    const r = await ollamaJSON(nativeBase, modelId, system, user, signal);
    return { raw: r.raw, data: r.data };
  };
}
