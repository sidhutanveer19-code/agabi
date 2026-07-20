import type { WorkspaceDoc } from "@/features/workspace/types";
import { workspaceDocSchema } from "./schema";
import { runMigrations } from "./migrations";

/** Serialize a workspace document to a JSON string. */
export function serialize(doc: WorkspaceDoc): string {
  return JSON.stringify(doc);
}

/**
 * Deserialize + validate + migrate. Returns null on corrupt/invalid data so the
 * caller can recover to a fresh document (never crash).
 */
export function deserialize(json: string): WorkspaceDoc | null {
  try {
    const raw: unknown = JSON.parse(json);
    const parsed = workspaceDocSchema.safeParse(raw);
    if (!parsed.success) return null;
    return runMigrations(parsed.data as WorkspaceDoc);
  } catch {
    return null;
  }
}
