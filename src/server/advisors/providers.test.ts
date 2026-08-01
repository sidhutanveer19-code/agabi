import { vi, beforeEach, describe, it, expect } from "vitest";

// Mutable env stand-in — providerChain reads `env.X` at CALL time, so mutating this object between
// tests exercises every branch without reloading modules. (Mocking the I/O boundary only, §H1.7.)
// vi.hoisted so the object exists when the hoisted vi.mock factory runs.
const mockEnv = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock("@/env", () => ({ env: mockEnv }));

import { providerChain, isFallthroughError, ollamaEntries, ollamaOnlyMasksCloudKey } from "@/server/advisors/providers";

beforeEach(() => {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe("providerChain — ordered free-model ladder, built from env keys", () => {
  it("no keys configured → empty chain (caller must handle 'no model')", () => {
    expect(providerChain()).toEqual([]);
  });

  it("each key adds exactly its provider", () => {
    mockEnv.GOOGLE_API_KEY = "g";
    expect(providerChain().map((p) => p.name)).toEqual(["google:gemini-2.0-flash"]);
    delete mockEnv.GOOGLE_API_KEY;
    mockEnv.GROQ_API_KEY = "k";
    expect(providerChain().map((p) => p.name)).toEqual(["groq:llama-3.3-70b-versatile"]);
  });

  it("ORDER is fixed: google → groq → cerebras → nvidia (the ladder, not key insertion order)", () => {
    mockEnv.NVIDIA_API_KEY = "n";
    mockEnv.CEREBRAS_API_KEY = "c";
    mockEnv.GROQ_API_KEY = "k";
    mockEnv.GOOGLE_API_KEY = "g";
    expect(providerChain().map((p) => p.name)).toEqual([
      "google:gemini-2.0-flash",
      "groq:llama-3.3-70b-versatile",
      "cerebras:llama-3.3-70b",
      "nvidia:llama-3.3-70b",
    ]);
  });

  it("cloud providers advertise tool support (drives the batch path)", () => {
    mockEnv.GROQ_API_KEY = "k";
    expect(providerChain()[0].caps).toEqual({ supportsTools: true, supportsJSON: true });
  });

  it("OLLAMA_BASE_URL appends the 2 local entries AFTER the cloud ones", () => {
    mockEnv.GROQ_API_KEY = "k";
    mockEnv.OLLAMA_BASE_URL = "http://localhost:11434/v1";
    const names = providerChain().map((p) => p.name);
    expect(names).toEqual(["groq:llama-3.3-70b-versatile", "ollama:qwen2.5:3b", "ollama:qwen2.5:7b"]);
  });

  it("OLLAMA_ONLY=1 overrides everything → exactly the 2 local entries, cloud keys ignored", () => {
    mockEnv.GOOGLE_API_KEY = "g";
    mockEnv.GROQ_API_KEY = "k";
    mockEnv.OLLAMA_ONLY = "1";
    expect(providerChain().map((p) => p.name)).toEqual(["ollama:qwen2.5:3b", "ollama:qwen2.5:7b"]);
  });

  it("ollamaOnlyMasksCloudKey: true only when OLLAMA_ONLY=1 AND a cloud key is present (R2 footgun)", () => {
    mockEnv.OLLAMA_ONLY = "1";
    mockEnv.GROQ_API_KEY = "k";
    expect(ollamaOnlyMasksCloudKey()).toBe(true); // masking a real key → footgun
    delete mockEnv.GROQ_API_KEY;
    expect(ollamaOnlyMasksCloudKey()).toBe(false); // OLLAMA_ONLY but no cloud key → legit offline floor
    mockEnv.GOOGLE_API_KEY = "g";
    delete mockEnv.OLLAMA_ONLY;
    expect(ollamaOnlyMasksCloudKey()).toBe(false); // cloud key present but OLLAMA_ONLY off → not masking
  });
});

describe("ollamaEntries — the local floor", () => {
  it("is the fast-3B-then-clean-7B pair, each carrying its native /api/chat base", () => {
    const e = ollamaEntries();
    expect(e.map((x) => x.ollama?.modelId)).toEqual(["qwen2.5:3b", "qwen2.5:7b"]);
    expect(e[0].ollama?.nativeBase).toBe("http://localhost:11434"); // /v1 stripped for native path
    expect(e[0].caps).toEqual({ supportsTools: false, supportsJSON: true });
  });

  it("strips a trailing /v1 (with or without slash) from a custom OLLAMA_BASE_URL", () => {
    mockEnv.OLLAMA_BASE_URL = "http://box:11434/v1/";
    expect(ollamaEntries()[0].ollama?.nativeBase).toBe("http://box:11434");
  });
});

describe("isFallthroughError — retry the next provider on a transient failure, not a real bug", () => {
  it("HTTP 429 + 5xx (statusCode OR status) fall through", () => {
    expect(isFallthroughError({ statusCode: 429 })).toBe(true);
    expect(isFallthroughError({ status: 503 })).toBe(true);
    expect(isFallthroughError({ statusCode: 500 })).toBe(true);
  });
  it("a 4xx that is NOT 429 does NOT fall through (it's a real client error)", () => {
    expect(isFallthroughError({ statusCode: 400 })).toBe(false);
    expect(isFallthroughError({ status: 401 })).toBe(false);
  });
  it("matches transient wording in the message when there's no code", () => {
    for (const m of ["rate limit hit", "quota exceeded", "model overloaded", "service unavailable", "gateway timeout", "got a 502"]) {
      expect(isFallthroughError({ message: m })).toBe(true);
    }
  });
  it("a plain bad-request message is NOT transient", () => {
    expect(isFallthroughError({ message: "invalid request: bad field" })).toBe(false);
  });
  it("never throws on junk input (undefined / null / empty)", () => {
    expect(isFallthroughError(undefined)).toBe(false);
    expect(isFallthroughError(null)).toBe(false);
    expect(isFallthroughError({})).toBe(false);
  });
});
