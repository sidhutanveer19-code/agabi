/**
 * Transport rules for the Agabi API. No business logic — just how bytes move.
 */
export const TRANSPORT = {
  /** `/teach` streams newline-delimited JSON: one TeachEvent object per line. */
  streamContentType: "application/x-ndjson",
  jsonContentType: "application/json",
  /** The session lives in an httpOnly cookie — clients send credentials: "include". */
  credentials: "include",
  /** CSRF: double-submit cookie — the client echoes the csrf cookie value in this header. */
  csrfHeader: "x-csrf-token",
  csrfCookie: "csrf",
} as const;
