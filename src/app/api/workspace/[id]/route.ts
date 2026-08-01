import { getUserId } from "@/server/auth";
import { prisma } from "@/server/db";
import { env } from "@/env";
import { emit, EVENTS } from "@/server/events";
import { storageId } from "@/server/conversation/ids";
import { workspaceStateSchema } from "@contract/schemas";
import type { Prisma } from "@prisma/client";

// GET/PUT /api/workspace/[id] — persist the workspace {doc, camera} [I2].
// Stored under `${userId}:${id}` so every user's "default" workspace is isolated.
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return json({ code: "unauthenticated", message: "Sign in first.", recoverable: false }, 401);
  const { id } = await params;

  const ws = await prisma.workspace.findUnique({ where: { id: storageId(userId, id) } }).catch(() => null);
  if (!ws || ws.userId !== userId) return json({ code: "not_found", message: "No workspace yet.", recoverable: true }, 404);

  return json({ doc: ws.doc, camera: ws.camera });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return json({ code: "unauthenticated", message: "Sign in first.", recoverable: false }, 401);
  const { id } = await params;

  const raw = await req.text();
  if (raw.length > env.MAX_DOC_BYTES) return json({ code: "too_large", message: "Workspace too large.", recoverable: false }, 413);

  let bodyUnknown: unknown;
  try {
    bodyUnknown = JSON.parse(raw);
  } catch {
    return json({ code: "bad_request", message: "Invalid JSON.", recoverable: false }, 400);
  }
  const parsed = workspaceStateSchema.safeParse(bodyUnknown);
  if (!parsed.success) return json({ code: "bad_request", message: "Invalid workspace shape.", recoverable: false }, 400);

  const doc = parsed.data.doc as unknown as Prisma.InputJsonValue;
  const camera = parsed.data.camera as unknown as Prisma.InputJsonValue;
  const key = storageId(userId, id);

  await prisma.workspace.upsert({
    where: { id: key },
    create: { id: key, userId, doc, camera },
    update: { doc, camera },
  });

  await emit(userId, EVENTS.workspaceSaved, { id }, "server");
  return json({ ok: true });
}
