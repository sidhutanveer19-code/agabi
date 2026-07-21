import { getUserId } from "@/server/auth";
import { checkRateLimit } from "@/server/rateLimit";
import { teachBodySchema } from "@contract/schemas";
import { run } from "@/server/conversation/manager";

// POST /api/teach — NDJSON stream of TeachEvents. The name is now inaccurate (the
// backend decides whether to teach at all) but the frozen frontend calls this path,
// so it stays. This file is a thin adapter: auth + rate-limit + stream → the
// conversation manager owns everything else.
export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Pro; Hobby is lower (D3 risk)

function jsonErr(code: string, message: string, status: number, recoverable: boolean) {
  return new Response(JSON.stringify({ code, message, recoverable }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return jsonErr("unauthenticated", "Sign in first.", 401, false);

  const rl = checkRateLimit(`teach:${userId}`);
  if (!rl.ok) return jsonErr("rate_limited", "Too many lessons this minute — take a breath.", 429, true);

  const parsed = teachBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonErr("bad_request", "Invalid teach request.", 400, false);
  const { request, context } = parsed.data;

  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Every TeachEvent carries `v:1` (B2) — additive; the frozen frontend ignores it.
      const write = (ev: object) => {
        try { controller.enqueue(encoder.encode(JSON.stringify({ v: 1, ...ev }) + "\n")); } catch { /* closed */ }
      };
      try {
        await run(request, context, userId, { write, signal: ac.signal });
      } catch (e) {
        write({ t: "error", recoverable: true, message: e instanceof Error ? e.message : "The teacher hit a snag." });
        write({ t: "done" });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache, no-transform" },
  });
}
