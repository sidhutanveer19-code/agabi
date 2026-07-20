import { TRANSPORT, apiErrorSchema } from "@contract";
import { API_BASE_URL, HAS_BACKEND, REQUEST_TIMEOUT } from "@/features/platform/config";

/** Typed client error. `recoverable` drives whether the UI offers a retry. */
export class ApiClientError extends Error {
  code: string;
  status: number;
  recoverable: boolean;
  constructor(message: string, opts: { code: string; status: number; recoverable: boolean }) {
    super(message);
    this.name = "ApiClientError";
    this.code = opts.code;
    this.status = opts.status;
    this.recoverable = opts.recoverable;
  }
}

/** Broadcast a 401 so the SessionProvider can surface "session expired". */
function signalUnauthenticated() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("agabi:unauthenticated"));
}

/** CSRF double-submit: echo the csrf cookie value in the request header. */
function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(new RegExp(`(?:^|; )${TRANSPORT.csrfCookie}=([^;]+)`));
  return m ? { [TRANSPORT.csrfHeader]: decodeURIComponent(m[1]) } : {};
}

async function mapError(res: Response): Promise<ApiClientError> {
  let code = `http_${res.status}`;
  let message = res.statusText || "Request failed";
  let recoverable = res.status >= 500 || res.status === 408 || res.status === 429;
  try {
    const body = await res.json();
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      code = parsed.data.code;
      message = parsed.data.message;
      recoverable = parsed.data.recoverable;
    }
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401) {
    code = "unauthenticated";
    recoverable = true;
    signalUnauthenticated();
  }
  return new ApiClientError(message, { code, status: res.status, recoverable });
}

interface RequestInitEx {
  method: string;
  body?: unknown;
  signal?: AbortSignal;
  /** streaming responses skip the timeout + JSON parsing. */
  stream?: boolean;
  retries?: number;
}

function assertBackend() {
  if (!HAS_BACKEND) {
    throw new ApiClientError("Backend not configured.", { code: "no_backend", status: 0, recoverable: true });
  }
}

async function raw(path: string, init: RequestInitEx): Promise<Response> {
  assertBackend();
  const headers: Record<string, string> = { ...csrfHeader() };
  if (init.body !== undefined) headers["content-type"] = TRANSPORT.jsonContentType;

  // Compose caller signal with an optional timeout (non-streaming only).
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  init.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = init.stream ? null : setTimeout(() => ac.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(API_BASE_URL + path, {
      method: init.method,
      headers,
      credentials: TRANSPORT.credentials,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ac.signal,
    });
    if (!res.ok) throw await mapError(res);
    return res;
  } catch (e) {
    if (e instanceof ApiClientError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new ApiClientError("Request timed out or was cancelled.", { code: "aborted", status: 0, recoverable: true });
    }
    throw new ApiClientError("Network error — is the backend reachable?", { code: "network", status: 0, recoverable: true });
  } finally {
    if (timer) clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

async function withRetry(path: string, init: RequestInitEx): Promise<Response> {
  const attempts = (init.retries ?? 0) + 1;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await raw(path, init);
    } catch (e) {
      last = e;
      // Only retry transient, recoverable, non-auth failures.
      if (!(e instanceof ApiClientError) || !e.recoverable || e.code === "unauthenticated" || e.code === "no_backend") break;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    }
  }
  throw last;
}

export const apiClient = {
  async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await withRetry(path, { method: "GET", signal, retries: 2 });
    return (await res.json()) as T;
  },
  async putJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await withRetry(path, { method: "PUT", body, signal, retries: 2 });
    return (await res.json().catch(() => ({}))) as T;
  },
  async postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await raw(path, { method: "POST", body, signal });
    return (await res.json().catch(() => ({}))) as T;
  },
  /** Streaming POST — returns the raw Response for the NDJSON reader. No timeout, no retry. */
  async postStream(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    return raw(path, { method: "POST", body, signal, stream: true });
  },
};
