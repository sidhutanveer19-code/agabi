import { vi, beforeEach, describe, it, expect } from "vitest";

/**
 * Mutation-kill tests for providers.ts. Each test pins the EXACT value/shape a
 * surviving Stryker mutant would flip. The SDK factory modules are mocked at the
 * narrowest I/O edge so we can capture the config object + model id each provider
 * is built with (never asserting merely "it ran", §H1). The sibling
 * providers.test.ts stays untouched.
 */

// providerChain / ollamaEntry read `env.X` at CALL time — mutating this object
// between tests exercises every branch without reloading modules.
const mockEnv = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock("@/env", () => ({ env: mockEnv }));

// Capture stores for the three provider factories. Each factory records the
// config it was constructed with, and the returned handle records the model id
// it was called with — that is what the ObjectLiteral / StringLiteral mutants flip.
const cap = vi.hoisted(() => ({
  google: [] as unknown[],
  googleIds: [] as unknown[],
  groq: [] as unknown[],
  groqIds: [] as unknown[],
  oai: [] as unknown[],
  oaiIds: [] as unknown[],
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: (config: unknown) => {
    cap.google.push(config);
    return (modelId: unknown) => {
      cap.googleIds.push(modelId);
      return { __p: "google", modelId };
    };
  },
}));
vi.mock("@ai-sdk/groq", () => ({
  createGroq: (config: unknown) => {
    cap.groq.push(config);
    return (modelId: unknown) => {
      cap.groqIds.push(modelId);
      return { __p: "groq", modelId };
    };
  },
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: (config: unknown) => {
    cap.oai.push(config);
    return (modelId: unknown) => {
      cap.oaiIds.push(modelId);
      return { __p: "oai", modelId };
    };
  },
}));

import { providerChain, ollamaEntries, isFallthroughError } from "@/server/advisors/providers";

beforeEach(() => {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  cap.google.length = 0;
  cap.googleIds.length = 0;
  cap.groq.length = 0;
  cap.groqIds.length = 0;
  cap.oai.length = 0;
  cap.oaiIds.length = 0;
});

// ---------------------------------------------------------------------------
// ollamaNativeBase — anchored /v1 strip (L31)
// ---------------------------------------------------------------------------

describe("ollamaNativeBase — the /v1 strip is anchored to the END of the URL", () => {
  it("L31:21 (drop the $ anchor): a /v1 in the MIDDLE of the path is left intact", () => {
    // Original /\/v1\/?$/ only strips a TRAILING /v1(/). "http://host/v1/chat"
    // does not end in /v1, so it is returned unchanged. The un-anchored mutant
    // /\/v1\/?/ replaces the first /v1 anywhere -> "http://host/chat".
    mockEnv.OLLAMA_BASE_URL = "http://host/v1/chat";
    expect(ollamaEntries()[0].ollama?.nativeBase).toBe("http://host/v1/chat");
  });
});

// ---------------------------------------------------------------------------
// ollamaEntry — the createOpenAICompatible config for a local entry (L35, L36)
// ---------------------------------------------------------------------------

describe("ollamaEntry — the local OpenAI-compat client is built from OLLAMA_BASE_URL", () => {
  it("L35:14 (?? -> &&) + L36 config: a CUSTOM OLLAMA_BASE_URL is the baseURL, exact name/apiKey", () => {
    // `??` keeps the custom value; the `&&` mutant would discard it and use the
    // right-hand default "http://localhost:11434/v1" instead.
    mockEnv.OLLAMA_BASE_URL = "http://custom:9999/v1";
    ollamaEntries(); // builds two local entries -> two factory calls
    const expected = { name: "ollama", baseURL: "http://custom:9999/v1", apiKey: "ollama" };
    // toEqual on the full shape kills L36:41 ({} -> no keys), L36:49 (name "")
    // and L36:80 (apiKey ""); the baseURL kills L35:14 (&& would give the default).
    expect(cap.oai).toEqual([expected, expected]);
  });

  it("L35:37 (default string -> \"\"): with OLLAMA_BASE_URL UNSET the baseURL is the localhost default", () => {
    ollamaEntries();
    // `undefined ?? "http://localhost:11434/v1"`. The "" mutant makes baseURL "";
    // the && mutant (L35:14, other direction) makes it undefined.
    expect((cap.oai[0] as { baseURL: string }).baseURL).toBe("http://localhost:11434/v1");
  });
});

// ---------------------------------------------------------------------------
// providerChain — cloud entries built from env keys (L59-L72)
// ---------------------------------------------------------------------------

describe("providerChain — each cloud provider is constructed with its exact config + model id", () => {
  it("L59:45 (config -> {}) + L60:65 (model id -> \"\"): google gets {apiKey} and 'gemini-2.0-flash'", () => {
    mockEnv.GOOGLE_API_KEY = "gk";
    providerChain();
    expect(cap.google).toEqual([{ apiKey: "gk" }]); // {} would drop apiKey
    expect(cap.googleIds).toEqual(["gemini-2.0-flash"]); // "" would be [""]
  });

  it("L63:29 (config -> {}) + L64:68 (model id -> \"\"): groq gets {apiKey} and 'llama-3.3-70b-versatile'", () => {
    mockEnv.GROQ_API_KEY = "qk";
    providerChain();
    expect(cap.groq).toEqual([{ apiKey: "qk" }]);
    expect(cap.groqIds).toEqual(["llama-3.3-70b-versatile"]);
  });

  it("L67:45/53/74 (config/name/baseURL) + L68:66 (model id): cerebras exact shape", () => {
    mockEnv.CEREBRAS_API_KEY = "ck";
    providerChain(); // no ollama/nvidia env -> exactly one openai-compat client
    expect(cap.oai).toEqual([{ name: "cerebras", baseURL: "https://api.cerebras.ai/v1", apiKey: "ck" }]);
    expect(cap.oaiIds).toEqual(["llama-3.3-70b"]);
  });

  it("L71:43/51/70 (config/name/baseURL) + L72:62 (model id): nvidia exact shape", () => {
    mockEnv.NVIDIA_API_KEY = "nk";
    providerChain();
    expect(cap.oai).toEqual([{ name: "nvidia", baseURL: "https://integrate.api.nvidia.com/v1", apiKey: "nk" }]);
    expect(cap.oaiIds).toEqual(["meta/llama-3.3-70b-instruct"]);
  });
});

// ---------------------------------------------------------------------------
// isFallthroughError — typeof-number guard (L84) + fence-less rate-limit regex (L85)
// ---------------------------------------------------------------------------

describe("isFallthroughError — guard + message-regex mutants", () => {
  it("L84:24 (typeof code === 'number' -> true): a STRING '503' code is NOT a fallthrough", () => {
    // Real: the typeof guard is false for a string, so the >=500 branch is skipped
    // and the (empty) message doesn't match -> false. The `-> true` mutant makes it
    // `true && "503" >= 500` -> 503 >= 500 -> true.
    expect(isFallthroughError({ statusCode: "503" })).toBe(false);
  });

  it("L85:10 (rate.?limit -> rate.limit): 'ratelimit' with NO separator is still transient", () => {
    // `.?` matches zero chars, so "ratelimit" (rate+limit adjacent) matches. The
    // mutant drops the `?`, so `.` demands exactly one char between the words and
    // "ratelimit" no longer matches (nor does any other alternative) -> false.
    expect(isFallthroughError({ message: "ratelimit" })).toBe(true);
  });
});
