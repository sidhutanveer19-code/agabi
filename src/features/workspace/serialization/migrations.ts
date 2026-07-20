import { SCHEMA_VERSION } from "@/features/workspace/types";

/**
 * Forward migrations for the workspace document. A migration takes the raw parsed
 * object at version N and returns it at version N+1.
 *
 * Contract: future Agabi versions MUST always be able to read old workspace data.
 * When the schema changes, bump `SCHEMA_VERSION` and add a `migrations[n]` entry —
 * never break old saves.
 */
type RawDoc = Record<string, unknown>;

const migrations: Record<number, (doc: RawDoc) => RawDoc> = {
  // Example for the future:
  // 1: (doc) => ({ ...doc, schemaVersion: 2, /* transform v1 → v2 */ }),
};

/** Run every migration needed to bring `raw` up to the current schema version. */
export function runMigrations(raw: RawDoc): RawDoc {
  let doc = raw;
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;

  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) break; // no path forward — validation will reject if incompatible
    doc = migrate(doc);
    const next = typeof doc.schemaVersion === "number" ? doc.schemaVersion : version + 1;
    version = next > version ? next : version + 1;
  }
  return doc;
}
