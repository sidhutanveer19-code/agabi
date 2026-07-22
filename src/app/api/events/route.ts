import { getUserId } from "@/server/auth";
import { checkRateLimit } from "@/server/rateLimit";
import { emitMany, CLIENT_EVENT_ALLOWLIST } from "@/server/events";
import { eventsBodySchema } from "@contract/schemas";

// POST /api/events — batched client events. Auth-gated + rate-limited (an open
// append-only write endpoint is a spam/cost vector). Client events are marked
// source:"client" and never trusted for billing/safety [I4].
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return json({ code: "unauthenticated", message: "Sign in first.", recoverable: false }, 401);

  const rl = checkRateLimit(`events:${userId}`, 240);
  if (!rl.ok) return json({ code: "rate_limited", message: "Too many events.", recoverable: true }, 429);

  const parsed = eventsBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ code: "bad_request", message: "Invalid events batch.", recoverable: false }, 400);

  const rows = parsed.data.events
    .filter((e) => CLIENT_EVENT_ALLOWLIST.has(e.type)) // drop arbitrary/unknown client types
    .map((e) => ({ userId, type: e.type, payload: e.payload ?? {}, source: "client" as const, conversationId: e.workspaceId }));

  await emitMany(rows);
  return json({ ok: true, accepted: rows.length });
}
