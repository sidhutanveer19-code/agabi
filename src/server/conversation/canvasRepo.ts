import { prisma } from "@/server/db";
import { storageId } from "@/server/conversation/ids";
import { emptyDoc, DEFAULT_CAMERA } from "@/features/workspace/types/defaults";
import type { Prisma } from "@prisma/client";

/**
 * Stamp a canvas's title + subject onto its Workspace row — called ONCE, when the
 * first lesson on the canvas starts (the conversation manager already knows the topic
 * there). Upsert: if the doc-autosave hasn't created the row yet, seed a valid empty
 * doc/camera (shared from types/defaults so the shape can't drift and passes the read
 * schema); the frontend's later autosave overwrites doc/camera, leaving title/subject.
 */
export async function setCanvasMeta(
  userId: string,
  canvasId: string,
  meta: { title: string; subject: string },
): Promise<void> {
  const id = storageId(userId, canvasId);
  const doc = emptyDoc(meta.title) as unknown as Prisma.InputJsonValue;
  const camera = DEFAULT_CAMERA as unknown as Prisma.InputJsonValue;
  await prisma.workspace.upsert({
    where: { id },
    create: { id, userId, doc, camera, title: meta.title, subject: meta.subject },
    update: { title: meta.title, subject: meta.subject },
  });
}
