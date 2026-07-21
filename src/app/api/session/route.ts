import { getUserId, newAnonUserId, authCookieHeader } from "@/server/auth";

// GET /api/session — identify the student + bootstrap the signed session cookie.
// First visit mints an anonymous signed userId so the journey can teach + persist.
export const runtime = "nodejs";

export async function GET(req: Request) {
  let userId = await getUserId(req);
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });

  if (!userId) {
    userId = newAnonUserId();
    headers.append("set-cookie", authCookieHeader(userId));
  }
  // CSRF double-submit cookie (readable by client, echoed as x-csrf-token).
  headers.append("set-cookie", `csrf=${encodeURIComponent(userId.slice(0, 20))}; Path=/; SameSite=Lax`);

  return new Response(JSON.stringify({ student: { id: userId }, preferences: {} }), { headers });
}
