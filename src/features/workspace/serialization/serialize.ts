import type { WorkspaceDoc } from "@/features/workspace/types";
import { SCHEMA_VERSION } from "@/features/workspace/types";
import { workspaceDocSchema } from "@/features/workspace/serialization/schema";
import { runMigrations } from "@/features/workspace/serialization/migrations";
import { getBlockDefinition } from "@/features/workspace/blocks/registry";

/** Serialize a document to a stable, versioned JSON string. */
export function serialize(doc: WorkspaceDoc): string {
  return JSON.stringify(doc);
}

/**
 * Parse + validate + migrate a JSON string back into a document. Returns `null`
 * on anything malformed (bad JSON, wrong shape) so callers can recover to a fresh
 * workspace instead of crashing.
 */
export function deserialize(json: string): WorkspaceDoc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;

  const migrated = runMigrations(raw as Record<string, unknown>);
  const parsed = workspaceDocSchema.safeParse(migrated);
  if (!parsed.success) return null;

  // Never load an incompatible schema: data newer than this build (or that
  // migrations could not bring current) is rejected rather than mis-rendered.
  if (parsed.data.schemaVersion !== SCHEMA_VERSION) return null;

  // Per-block type safety: validate each block's `data` against its registered
  // schema and drop blocks that fail (or whose type validates false). Unknown
  // types (not yet registered) are kept — they simply render nothing.
  const doc = parsed.data as WorkspaceDoc;
  doc.regions = doc.regions.map((region) => ({
    ...region,
    blocks: region.blocks.filter((block) => {
      const def = getBlockDefinition(block.type);
      if (!def?.schema) return true;
      return def.schema.safeParse(block.data).success;
    }),
  }));
  return doc;
}
