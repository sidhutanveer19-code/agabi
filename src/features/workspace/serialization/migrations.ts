import type { WorkspaceDoc } from "@/features/workspace/types";
import { SCHEMA_VERSION } from "@/features/workspace/types";

/**
 * Ordered schema migrations, keyed by the version they upgrade FROM. Only v1
 * exists today, so the map is empty; this is the extension point for
 * forward-compatible document upgrades.
 */
const migrations: Record<number, (doc: WorkspaceDoc) => WorkspaceDoc> = {};

export function runMigrations(doc: WorkspaceDoc): WorkspaceDoc {
  let current = doc;
  while (current.schemaVersion < SCHEMA_VERSION) {
    const step = migrations[current.schemaVersion];
    if (!step) break;
    current = step(current);
  }
  return current.schemaVersion === SCHEMA_VERSION
    ? current
    : { ...current, schemaVersion: SCHEMA_VERSION };
}
