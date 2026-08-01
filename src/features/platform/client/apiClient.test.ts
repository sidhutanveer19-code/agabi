import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRANSPORT } from "@contract";

/**
 * HARD branch tests for the platform apiClient. The ONLY I/O edges faked are the
 * network (`global.fetch`), the clock (`setTimeout` via fake timers), and the two
 * browser globals the module probes (`window`, `document`) — everything else is the
 * module's OWN logic exercised for real: csrf double-submit header derivation,
 * content-type gating on body presence, JSON→ApiError mapping + schema validation,
 * the 401 unauthenticated broadcast, timeout/abort/network error classification,
 * the assertBackend guard, and the exponential-backoff retry policy (retry vs break
 * on non-recoverable / unauthenticated / no_backend). Every assertion names the
 * EXACT result — code/status/recoverable/message/headers/body/call-count — never
 * "did not throw".
 *
 * `@/features/platform/config` is mocked with live getters so HAS_BACKEND (a real
 * `true` const in source) can be toggled to reach the no_backend branch.
 */

const cfg = vi.hoisted(() => ({ apiBaseUrl: "", hasBackend: true, requestTimeout: 20_000 }));
vi.mock("@/features/platform/config", () => ({
  get API_BASE_URL() {
    return cfg.apiBaseUrl;
  },
  get HAS_BACKEND() {
    return cfg.hasBackend;
  },
  get REQUEST_TIMEOUT() {
    return cfg.requestTimeout;
  },
}));

const { apiClient, ApiClientError } = await import("@/features/platform/client/apiClient");

// ---- Response builders (fetch's return contract: ok/status/statusText/json) ----

type ResShape = { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> };
function res(over: Partial<ResShape> & Pick<ResShape, "status">): Response {
  const ok = over.ok ?? over.status < 400;
  return {
    ok,
    status: over.status,
    statusText: over.statusText ?? "",
    json: over.json ?? (async () => ({})),
  } as unknown as Response;
}
const resOk = (body: unknown): Response => res({ status: 200, statusText: "OK", json: async () => body });
const nonJson = (status: number, statusText: string): Response =>
  res({ status, statusText, json: async () => {
    throw new SyntaxError("Unexpected token < in JSON");
  } });

type FetchInit = {
  method: string;
  headers: Record<string, string>;
  credentials: string;
  body?: string;
  signal: AbortSignal;
};
function lastInit(mock: ReturnType<typeof vi.fn>): FetchInit {
  const call = mock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was never called");
  return call[1] as FetchInit;
}
function stub(mock: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal("fetch", mock);
}

/** Await a promise expected to reject with an ApiClientError; return it for assertions. */
async function rejectsWith(p: Promise<unknown>): Promise<InstanceType<typeof ApiClientError>> {
  try {
    await p;
  } catch (e) {
    return e as InstanceType<typeof ApiClientError>;
  }
  throw new Error("expected the promise to reject, but it resolved");
}

beforeEach(() => {
  cfg.apiBaseUrl = "";
  cfg.hasBackend = true;
  cfg.requestTimeout = 20_000;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("ApiClientError", () => {
  it("carries message + code/status/recoverable and is a real Error subclass", () => {
    const e = new ApiClientError("boom", { code: "c", status: 418, recoverable: false });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ApiClientError);
    expect(e.name).toBe("ApiClientError");
    expect(e.message).toBe("boom");
    expect(e.code).toBe("c");
    expect(e.status).toBe(418);
    expect(e.recoverable).toBe(false);
  });
});

describe("request headers — csrf double-submit + content-type gating", () => {
  it("document undefined (node) → no csrf header; GET with no body → no content-type; base url is prefixed", async () => {
    cfg.apiBaseUrl = "http://api.test";
    const mock = vi.fn().mockResolvedValue(resOk({ ok: 1 }));
    stub(mock);

    await apiClient.getJson("/thing");

    const init = lastInit(mock);
    expect(mock.mock.calls[0][0]).toBe("http://api.test/thing"); // API_BASE_URL + path
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({}); // no csrf, no content-type
  });

  it("document with csrf cookie → x-csrf-token echoes the URL-decoded cookie value", async () => {
    vi.stubGlobal("document", { cookie: "foo=bar; csrf=a%20b%2Fc; other=1" });
    const mock = vi.fn().mockResolvedValue(resOk({ ok: 1 }));
    stub(mock);

    await apiClient.getJson("/x");

    expect(lastInit(mock).headers[TRANSPORT.csrfHeader]).toBe("a b/c"); // decodeURIComponent("a%20b%2Fc")
  });

  it("document present but NO csrf cookie → no csrf header", async () => {
    vi.stubGlobal("document", { cookie: "session=zzz; theme=dark" });
    const mock = vi.fn().mockResolvedValue(resOk({ ok: 1 }));
    stub(mock);

    await apiClient.getJson("/x");

    expect(TRANSPORT.csrfHeader in lastInit(mock).headers).toBe(false);
  });

  it("body present (POST) → content-type application/json AND JSON-stringified body", async () => {
    const mock = vi.fn().mockResolvedValue(resOk({}));
    stub(mock);

    await apiClient.postJson("/save", { a: 1, b: [true] });

    const init = lastInit(mock);
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe(TRANSPORT.jsonContentType);
    expect(init.body).toBe(JSON.stringify({ a: 1, b: [true] }));
  });
});

describe("success paths — the four verbs", () => {
  it("getJson returns the parsed JSON body verbatim", async () => {
    stub(vi.fn().mockResolvedValue(resOk({ id: "e1", n: 7 })));
    expect(await apiClient.getJson<{ id: string; n: number }>("/g")).toEqual({ id: "e1", n: 7 });
  });

  it("putJson returns the parsed body on success", async () => {
    const mock = vi.fn().mockResolvedValue(resOk({ updated: true }));
    stub(mock);
    expect(await apiClient.putJson("/u", { x: 1 })).toEqual({ updated: true });
    expect(lastInit(mock).method).toBe("PUT");
  });

  it("putJson swallows an empty/invalid JSON body → returns {}", async () => {
    stub(vi.fn().mockResolvedValue(res({ status: 200, statusText: "OK", json: async () => {
      throw new Error("no body");
    } })));
    expect(await apiClient.putJson("/u", { x: 1 })).toEqual({});
  });

  it("postJson returns the parsed body on success", async () => {
    stub(vi.fn().mockResolvedValue(resOk({ created: "c9" })));
    expect(await apiClient.postJson("/p", { name: "z" })).toEqual({ created: "c9" });
  });

  it("postJson swallows a non-JSON body → returns {}", async () => {
    stub(vi.fn().mockResolvedValue(res({ status: 200, statusText: "OK", json: async () => {
      throw new Error("204 no content");
    } })));
    expect(await apiClient.postJson("/p", {})).toEqual({});
  });

  it("postStream returns the RAW Response (no json parse, stream mode) with a POST body", async () => {
    const raw = resOk({ ignored: true });
    const mock = vi.fn().mockResolvedValue(raw);
    stub(mock);

    const out = await apiClient.postStream("/teach", { q: "hi" }, new AbortController().signal);
    expect(out).toBe(raw); // the exact Response object, untouched
    const init = lastInit(mock);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ q: "hi" }));
  });
});

describe("mapError — status → {code, message, recoverable}", () => {
  it("500 non-JSON body → code http_500, message = statusText, recoverable (>=500)", async () => {
    stub(vi.fn().mockResolvedValue(nonJson(500, "Server Error")));
    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e).toBeInstanceOf(ApiClientError);
    expect(e.code).toBe("http_500");
    expect(e.status).toBe(500);
    expect(e.message).toBe("Server Error");
    expect(e.recoverable).toBe(true);
  });

  it("empty statusText → message falls back to 'Request failed'", async () => {
    stub(vi.fn().mockResolvedValue(nonJson(500, "")));
    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e.message).toBe("Request failed");
  });

  it("408 → recoverable true (timeout is transient)", async () => {
    stub(vi.fn().mockResolvedValue(nonJson(408, "Request Timeout")));
    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e.code).toBe("http_408");
    expect(e.recoverable).toBe(true);
  });

  it("429 → recoverable true (rate limited is transient)", async () => {
    stub(vi.fn().mockResolvedValue(nonJson(429, "Too Many Requests")));
    expect((await rejectsWith(apiClient.postJson("/p", {}))).recoverable).toBe(true);
  });

  it("400 non-JSON → recoverable FALSE (not 5xx/408/429)", async () => {
    stub(vi.fn().mockResolvedValue(nonJson(400, "Bad Request")));
    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e.code).toBe("http_400");
    expect(e.recoverable).toBe(false);
  });

  it("valid ApiError JSON body OVERRIDES every default (code/message/recoverable)", async () => {
    // 400 default recoverable=false, but the body says recoverable=true → body wins.
    stub(vi.fn().mockResolvedValue(
      res({ status: 400, statusText: "Bad Request", json: async () => ({ code: "rate_thing", message: "slow down", recoverable: true }) }),
    ));
    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e.code).toBe("rate_thing");
    expect(e.message).toBe("slow down");
    expect(e.recoverable).toBe(true);
    expect(e.status).toBe(400);
  });

  it("JSON body that FAILS the ApiError schema is ignored → defaults kept", async () => {
    // missing `message` + `recoverable` → safeParse fails → no override.
    stub(vi.fn().mockResolvedValue(
      res({ status: 503, statusText: "Unavailable", json: async () => ({ code: "only_code" }) }),
    ));
    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e.code).toBe("http_503"); // NOT "only_code"
    expect(e.message).toBe("Unavailable");
    expect(e.recoverable).toBe(true); // 503 >= 500
  });
});

describe("mapError — 401 unauthenticated broadcast", () => {
  it("401 forces code=unauthenticated + recoverable=true and dispatches agabi:unauthenticated (window present)", async () => {
    const dispatched: Event[] = [];
    vi.stubGlobal("window", { dispatchEvent: (ev: Event) => (dispatched.push(ev), true) });
    // Even a valid body with a different code is overridden by the 401 branch (message is kept).
    stub(vi.fn().mockResolvedValue(
      res({ status: 401, statusText: "Unauthorized", json: async () => ({ code: "token_x", message: "please sign in", recoverable: false }) }),
    ));

    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e.code).toBe("unauthenticated");
    expect(e.recoverable).toBe(true);
    expect(e.message).toBe("please sign in"); // body message survives; only code/recoverable forced
    expect(e.status).toBe(401);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toBeInstanceOf(CustomEvent);
    expect(dispatched[0].type).toBe("agabi:unauthenticated");
  });

  it("401 with window undefined → still maps to unauthenticated, broadcast silently skipped (no throw)", async () => {
    stub(vi.fn().mockResolvedValue(nonJson(401, "Unauthorized")));
    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e.code).toBe("unauthenticated");
    expect(e.recoverable).toBe(true);
  });
});

describe("raw — transport error classification (catch branches)", () => {
  it("fetch rejects with a generic Error → code 'network', status 0, recoverable", async () => {
    stub(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e.code).toBe("network");
    expect(e.status).toBe(0);
    expect(e.recoverable).toBe(true);
    expect(e.message).toBe("Network error — is the backend reachable?");
  });

  it("caller signal abort → AbortError classified as 'aborted' (single shot, no retry) and listener wired", async () => {
    const ac = new AbortController();
    const mock = vi.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    stub(mock as unknown as ReturnType<typeof vi.fn>);

    const p = apiClient.postJson("/p", { a: 1 }, ac.signal);
    ac.abort(); // caller signal → onAbort → inner AbortController.abort() → fetch rejects
    const e = await rejectsWith(p);
    expect(e.code).toBe("aborted");
    expect(e.status).toBe(0);
    expect(e.recoverable).toBe(true);
    expect(e.message).toBe("Request timed out or was cancelled.");
  });

  it("non-streaming request that never resolves → aborted by the REQUEST_TIMEOUT timer", async () => {
    vi.useFakeTimers();
    const mock = vi.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("timed out");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    stub(mock as unknown as ReturnType<typeof vi.fn>);

    const p = apiClient.postJson("/slow", {}); // no caller signal → exercises the signal-absent branch
    p.catch(() => {}); // pre-attach so the pending rejection is not "unhandled"
    await vi.advanceTimersByTimeAsync(cfg.requestTimeout); // fire the timeout → ac.abort()
    const e = await rejectsWith(p);
    expect(e.code).toBe("aborted");
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("assertBackend — no_backend guard", () => {
  it("HAS_BACKEND false → throws no_backend BEFORE any fetch", async () => {
    cfg.hasBackend = false;
    const mock = vi.fn();
    stub(mock);

    const e = await rejectsWith(apiClient.postJson("/p", {}));
    expect(e.code).toBe("no_backend");
    expect(e.status).toBe(0);
    expect(e.recoverable).toBe(true);
    expect(e.message).toBe("Backend not configured.");
    expect(mock).not.toHaveBeenCalled();
  });

  it("no_backend is NOT retried by withRetry (fetch never called across the whole getJson)", async () => {
    cfg.hasBackend = false;
    const mock = vi.fn();
    stub(mock);

    const e = await rejectsWith(apiClient.getJson("/g"));
    expect(e.code).toBe("no_backend");
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("withRetry — retry policy + exponential backoff", () => {
  it("recoverable failures are retried; succeeds on the 3rd attempt (backoff 250ms then 500ms)", async () => {
    vi.useFakeTimers();
    let n = 0;
    const mock = vi.fn().mockImplementation(async () => {
      n += 1;
      return n < 3 ? nonJson(500, "Server Error") : resOk({ value: 42 });
    });
    stub(mock);

    const p = apiClient.getJson<{ value: number }>("/r");
    await vi.advanceTimersByTimeAsync(250); // backoff after attempt 1 (250 * 2**0)
    await vi.advanceTimersByTimeAsync(500); // backoff after attempt 2 (250 * 2**1)
    expect(await p).toEqual({ value: 42 });
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("exhausts all 3 attempts on persistent 500 → rejects with the last error", async () => {
    vi.useFakeTimers();
    const mock = vi.fn().mockResolvedValue(nonJson(500, "Server Error"));
    stub(mock);

    const p = apiClient.getJson("/r");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    const e = await rejectsWith(p);
    expect(e.code).toBe("http_500");
    expect(mock).toHaveBeenCalledTimes(3); // retries:2 → 3 attempts, no 4th
  });

  it("non-recoverable (400) breaks immediately — no retry", async () => {
    const mock = vi.fn().mockResolvedValue(nonJson(400, "Bad Request"));
    stub(mock);
    const e = await rejectsWith(apiClient.getJson("/g"));
    expect(e.code).toBe("http_400");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("unauthenticated (401) breaks immediately despite being recoverable — no retry", async () => {
    const mock = vi.fn().mockResolvedValue(nonJson(401, "Unauthorized"));
    stub(mock);
    const e = await rejectsWith(apiClient.getJson("/g"));
    expect(e.code).toBe("unauthenticated");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("network errors are recoverable and ARE retried to exhaustion", async () => {
    vi.useFakeTimers();
    const mock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    stub(mock);

    const p = apiClient.getJson("/g");
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    const e = await rejectsWith(p);
    expect(e.code).toBe("network");
    expect(mock).toHaveBeenCalledTimes(3);
  });
});
