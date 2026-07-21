import { prisma } from "@/server/db";
import { providerChain } from "@/server/ai/providers";

// GET /api/health — liveness for the deploy (B4). DB ping + provider count, no dep.
// (Sentry DSN + "alert on authorRate<0.5" is deferred — needs the Sentry package.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let db = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    /* db down */
  }
  const providers = providerChain().map((p) => p.name);
  const ok = db === "up" && providers.length > 0;
  return new Response(JSON.stringify({ ok, db, providers, ts: Date.now() }), {
    status: ok ? 200 : 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
