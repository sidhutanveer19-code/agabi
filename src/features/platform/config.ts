/**
 * Backend connection config. When `NEXT_PUBLIC_API_BASE_URL` is set, the frontend
 * talks to the real backend; when unset (no backend running), backend-dependent
 * features degrade gracefully instead of crashing.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
export const HAS_BACKEND = API_BASE_URL.length > 0;

/** Default request timeout (ms) for non-streaming calls. */
export const REQUEST_TIMEOUT = 20_000;
