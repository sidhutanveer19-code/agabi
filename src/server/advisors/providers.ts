import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { env } from "@/env";

/**
 * Free-model chain (D2). Ordered; the teach ladder tries each provider in turn.
 * Fill strategy is chosen from `caps`, NEVER from the name (A) — adding Gemini or
 * OpenRouter later is a registry entry, not a routing change.
 *
 *   supportsTools → the batch tool path (one streamText, N tool calls).
 *   supportsJSON only + `ollama` set → the native JSON / text-stream path (B).
 */
export interface ProviderCaps {
  supportsTools: boolean;
  supportsJSON: boolean;
}
export interface ProviderEntry {
  name: string;
  model: LanguageModel; // AI SDK handle — the tool path uses this
  caps: ProviderCaps;
  /** Present iff this is a local Ollama entry — the native /api/chat path uses it. */
  ollama?: { nativeBase: string; modelId: string };
}

/** Native Ollama base (strip the /v1 OpenAI-compat suffix). The 2/3 JSON reliability
 *  was measured on native /api/chat, NOT the /v1 shim. */
function ollamaNativeBase(): string {
  const v1 = env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  return v1.replace(/\/v1\/?$/, "");
}

function ollamaEntry(modelId: string): ProviderEntry {
  const v1 = env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
  const ollama = createOpenAICompatible({ name: "ollama", baseURL: v1, apiKey: "ollama" });
  return {
    name: `ollama:${modelId}`,
    model: ollama(modelId),
    caps: { supportsTools: false, supportsJSON: true },
    ollama: { nativeBase: ollamaNativeBase(), modelId },
  };
}

/** The local floor: fast 3B first, 7B as the cleaner mop-up (C). */
export function ollamaEntries(): ProviderEntry[] {
  return [ollamaEntry("qwen2.5:3b"), ollamaEntry("qwen2.5:7b")];
}

/** True iff OLLAMA_ONLY=1 is MASKING a configured cloud key (Groq/Gemini/Cerebras/NVIDIA) —
 *  i.e. a strong model is available but the local-only test switch is forcing qwen instead. */
export function ollamaOnlyMasksCloudKey(): boolean {
  return (
    env.OLLAMA_ONLY === "1" &&
    [env.GOOGLE_API_KEY, env.GROQ_API_KEY, env.CEREBRAS_API_KEY, env.NVIDIA_API_KEY].some(Boolean)
  );
}

let warnedMask = false;
/** Boot-time footgun warning (Law 11), deduped so it fires once, not per request. */
function warnIfMaskingCloudKey(): void {
  if (warnedMask || !ollamaOnlyMasksCloudKey()) return;
  warnedMask = true;
  console.warn(
    "[providers] OLLAMA_ONLY=1 is forcing the local qwen model and MASKING a configured cloud key " +
      "(Groq/Gemini). Teaching will use the toy model — unset OLLAMA_ONLY for the strong model.",
  );
}

export function providerChain(): ProviderEntry[] {
  // Test switch: route everything at local Ollama (Groq daily cap exhausted / Gemini
  // key invalid). Guarded against production in env.ts.
  if (env.OLLAMA_ONLY === "1") {
    // Law 11 — loudly flag the footgun: OLLAMA_ONLY silently MASKS a configured cloud key, so
    // teaching runs on the local toy model. This is the bug that made lessons dumb/hallucinate.
    warnIfMaskingCloudKey();
    return ollamaEntries();
  }

  const chain: ProviderEntry[] = [];
  const tools: ProviderCaps = { supportsTools: true, supportsJSON: true };

  if (env.GOOGLE_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
    chain.push({ name: "google:gemini-2.0-flash", model: google("gemini-2.0-flash"), caps: tools });
  }
  if (env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY });
    chain.push({ name: "groq:llama-3.3-70b-versatile", model: groq("llama-3.3-70b-versatile"), caps: tools });
  }
  if (env.CEREBRAS_API_KEY) {
    const cerebras = createOpenAICompatible({ name: "cerebras", baseURL: "https://api.cerebras.ai/v1", apiKey: env.CEREBRAS_API_KEY });
    chain.push({ name: "cerebras:llama-3.3-70b", model: cerebras("llama-3.3-70b"), caps: tools });
  }
  if (env.NVIDIA_API_KEY) {
    const nvidia = createOpenAICompatible({ name: "nvidia", baseURL: "https://integrate.api.nvidia.com/v1", apiKey: env.NVIDIA_API_KEY });
    chain.push({ name: "nvidia:llama-3.3-70b", model: nvidia("meta/llama-3.3-70b-instruct"), caps: tools });
  }
  // Local floor — only when explicitly configured (never in prod: can't reach the laptop).
  if (env.OLLAMA_BASE_URL) chain.push(...ollamaEntries());

  return chain;
}

/** A thrown error worth falling through to the next provider (rate limit / server). */
export function isFallthroughError(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const code = e?.statusCode ?? e?.status;
  if (code === 429 || (typeof code === "number" && code >= 500)) return true;
  return /rate.?limit|429|quota|overloaded|unavailable|timeout|5\d\d/i.test(e?.message ?? "");
}
