/**
 * Structured logging — zero-dep, one JSON line to stdout/stderr. Vercel indexes JSON
 * stdout, so logs are queryable with no vendor; a Sentry sink slots in behind this
 * function later without touching a call site. Never logs a raw error — always the
 * `message` + `stack` + `cause` chain. BigInt-safe (seq etc. → string).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  event?: string;
  userId?: string | null;
  conversationId?: string | null;
  lessonId?: string | null;
  canvasId?: string | null;
  reqId?: string | null;
  [k: string]: unknown;
}

/** JSON.stringify replacer: BigInt → string (raw BigInt throws), Error → its chain. */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack, cause: value.cause };
  }
  return value;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}, err?: unknown): void {
  const line: Record<string, unknown> = { ts: new Date().toISOString(), level, event, ...fields };
  if (err !== undefined) {
    const e = err instanceof Error ? err : new Error(String(err));
    line.message = line.message ?? e.message;
    line.stack = e.stack;
    if (e.cause !== undefined) line.cause = e.cause;
  }
  let out: string;
  try {
    out = JSON.stringify(line, replacer);
  } catch (serErr) {
    // last-ditch: never let logging itself throw (e.g. a truly unserializable field)
    out = JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "log.serialize_failed", origEvent: event, message: String(serErr) });
  }
  if (level === "error" || level === "warn") process.stderr.write(out + "\n");
  else process.stdout.write(out + "\n");
}
