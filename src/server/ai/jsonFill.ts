/**
 * The Ollama JSON / text-stream fill path (B). Talks to the NATIVE Ollama API
 * (`/api/chat`), NOT the `/v1` OpenAI-compat shim — the 2/3 JSON reliability was
 * measured on native, and native returns `eval_count`/`eval_duration` (tokens +
 * tok/s) directly, which is what F needs. Isolated here; the rest of the app uses
 * the AI SDK.
 */

/** Permissive parse — same principle as the tool boundary: never throw. Strip
 *  markdown fences, extract the first balanced `{…}` (string-aware), JSON.parse.
 *  Returns null on any failure; the caller hands the raw text to coerceSlot. */
export function parseSlotJSON(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const candidate = end === -1 ? s.slice(start) : s.slice(start, end + 1);
  try {
    const v = JSON.parse(candidate);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface JsonSlotResult {
  data: Record<string, unknown>; // parsed object, or {} if unparseable (caller coerces raw)
  raw: string; // raw model text — handed to coerceSlot as a RUNG-4 repair on parse failure
  parsed: boolean;
  tokens: number; // eval_count
  ms: number; // eval_duration (native) or wall-clock fallback
}

interface NativeChatResponse {
  message?: { content?: string };
  eval_count?: number;
  eval_duration?: number; // nanoseconds
}

/** One-shot JSON request per slot (visual path). stream:false, format:"json". */
export async function ollamaJSON(
  nativeBase: string,
  modelId: string,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<JsonSlotResult> {
  const t0 = Date.now();
  const res = await fetch(`${nativeBase}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      stream: false,
      format: "json",
      options: { temperature: 0.4 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });
  const j = (await res.json()) as NativeChatResponse;
  const raw = j.message?.content ?? "";
  const data = parseSlotJSON(raw);
  return {
    data: data ?? {},
    raw,
    parsed: data !== null,
    tokens: j.eval_count ?? 0,
    ms: j.eval_duration ? Math.round(j.eval_duration / 1e6) : Date.now() - t0,
  };
}

/** Streaming prose request (text path, I). No json mode. Calls `onText` with the
 *  FULL accumulated text on each chunk; the caller throttles patch emission. */
export async function ollamaStream(
  nativeBase: string,
  modelId: string,
  system: string,
  user: string,
  signal: AbortSignal,
  onText: (full: string) => void,
): Promise<{ text: string; tokens: number; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${nativeBase}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      stream: true,
      options: { temperature: 0.6 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });
  const reader = res.body?.getReader();
  if (!reader) return { text: "", tokens: 0, ms: Date.now() - t0 };
  const dec = new TextDecoder();
  let buf = "", full = "", tokens = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line) as NativeChatResponse & { done?: boolean };
        const d = j.message?.content ?? "";
        if (d) { full += d; onText(full); }
        if (j.eval_count) tokens = j.eval_count;
      } catch {
        /* partial line — skip */
      }
    }
  }
  return { text: full, tokens, ms: Date.now() - t0 };
}
