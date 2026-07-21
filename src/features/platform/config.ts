/**
 * Backend connection config. The teach/session/events routes now ship IN-REPO at
 * same-origin `/api/*`, so the backend is always reachable (relative base when
 * `NEXT_PUBLIC_API_BASE_URL` is unset; set it to point elsewhere, e.g. the
 * dev-backend mock oracle on :8787 for PROVIDER=mock e2e).
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

/** In-repo routes exist → teaching/session/events are always available. */
export const HAS_BACKEND = true;

/**
 * Server-side workspace persistence needs a configured DB. Without one, fall back
 * to localStorage so the canvas still persists locally (D5: build without keys).
 * On when a base URL is set (mock oracle / remote) or explicitly flagged.
 */
export const HAS_SERVER_PERSISTENCE =
  API_BASE_URL.length > 0 || process.env.NEXT_PUBLIC_SERVER_PERSISTENCE === "1";

/** Default request timeout (ms) for non-streaming calls. */
export const REQUEST_TIMEOUT = 20_000;
