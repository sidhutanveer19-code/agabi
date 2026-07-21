import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { env } from "@/env";

/**
 * Free-model fallback chain (D2). Ordered; the teach route tries each until one
 * doesn't 429/500. Absent key → skipped (never crashes). Ollama is the local floor
 * that never rate-limits. NOT a framework — just an ordered list.
 *
 * Verify tool-calling per provider before trusting it (D2/U2): Cerebras + NVIDIA
 * OpenAI-compat tool calling is unverified; drop any that fail the probe.
 */
export interface ProviderEntry {
  name: string;
  model: LanguageModel;
}

export function providerChain(): ProviderEntry[] {
  const chain: ProviderEntry[] = [];

  if (env.GOOGLE_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
    chain.push({ name: "google:gemini-2.0-flash", model: google("gemini-2.0-flash") });
  }
  if (env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY });
    chain.push({ name: "groq:llama-3.3-70b-versatile", model: groq("llama-3.3-70b-versatile") });
  }
  if (env.CEREBRAS_API_KEY) {
    const cerebras = createOpenAICompatible({ name: "cerebras", baseURL: "https://api.cerebras.ai/v1", apiKey: env.CEREBRAS_API_KEY });
    chain.push({ name: "cerebras:llama-3.3-70b", model: cerebras("llama-3.3-70b") });
  }
  if (env.NVIDIA_API_KEY) {
    const nvidia = createOpenAICompatible({ name: "nvidia", baseURL: "https://integrate.api.nvidia.com/v1", apiKey: env.NVIDIA_API_KEY });
    chain.push({ name: "nvidia:llama-3.3-70b", model: nvidia("meta/llama-3.3-70b-instruct") });
  }
  if (env.OLLAMA_BASE_URL) {
    const ollama = createOpenAICompatible({ name: "ollama", baseURL: env.OLLAMA_BASE_URL, apiKey: "ollama" });
    chain.push({ name: "ollama:llama3.3", model: ollama("llama3.3") });
  }

  return chain;
}

/** A thrown error worth falling through to the next provider (rate limit / server). */
export function isFallthroughError(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const code = e?.statusCode ?? e?.status;
  if (code === 429 || (typeof code === "number" && code >= 500)) return true;
  return /rate.?limit|429|quota|overloaded|unavailable|timeout|5\d\d/i.test(e?.message ?? "");
}
