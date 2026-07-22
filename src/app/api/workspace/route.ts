import { getUserId } from "@/server/auth";
import { prisma } from "@/server/db";
import { bareId } from "@/server/conversation/ids";

// GET /api/workspace — list THIS user's canvases, newest first, for the sidebar.
// Returns ONLY summaries: { id(bare), title, subject, updatedAt }. Never doc/camera,
// never the composite `${userId}:${id}` key or userId (no prefix leak). 401 if no user.
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return json({ code: "unauthenticated", message: "Sign in first.", recoverable: false }, 401);

  const rows = await prisma.workspace
    .findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, subject: true, updatedAt: true },
    })
    .catch(() => []);

  const canvases = rows.map((r) => ({
    id: bareId(userId, r.id), // strip the `${userId}:` storage prefix — never leaks
    title: r.title,
    subject: r.subject,
    updatedAt: r.updatedAt.getTime(),
  }));

  return json(canvases);
}
