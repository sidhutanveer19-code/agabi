import { drainOutbox } from "@/server/evidence/outbox";
import { env } from "@/env";

// POST /api/internal/outbox/drain — cron-callable evidence recovery (Vercel Cron).
// Shared-secret header so it isn't a public drain trigger. The teach route also drains
// opportunistically; this is the scheduled backstop for idle periods.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (req.headers.get("x-agabi-cron-secret") !== env.AUTH_SECRET) {
    return new Response(JSON.stringify({ code: "forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  }
  const res = await drainOutbox(200);
  return new Response(JSON.stringify(res), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
