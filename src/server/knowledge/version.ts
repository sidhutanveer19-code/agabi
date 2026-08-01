import type { Release, ReleaseMember } from "@/server/knowledge/types";

/**
 * Versioning + releases (§19). Nothing is overwritten: editing creates a new row and the
 * old becomes DEPRECATED but stays readable forever. A Release pins exact version ids, so
 * a 2029 replay of a 2026 lesson resolves every statement and asset to the version the
 * learner actually saw. Trust is versioned WITH the row (§19), which is why point-in-time
 * resolution goes through the release, never a mutable current-trust column.
 */

/** Anything the version machinery treats as a versioned entity. */
export interface Versioned {
  id: string;
  version: number;
  supersedes: string | null;
  status?: string;
}

/**
 * Supersede: produce the next version of `current` carrying `changes`, and the marker
 * that the old row is now DEPRECATED. Non-destructive — both rows persist (§19). The
 * new row's `supersedes` points back at the exact prior id, forming the version chain.
 */
export function supersede<T extends Versioned>(
  current: T,
  next: Omit<T, "id" | "version" | "supersedes">,
  newId: string,
): { next: T; deprecated: T } {
  const nextRow = { ...(next as T), id: newId, version: current.version + 1, supersedes: current.id };
  const deprecated = { ...current, status: "DEPRECATED" };
  return { next: nextRow, deprecated };
}

/** Build a release pinning a set of (kind, entityId) members at their current versions. */
export function buildRelease(
  id: string,
  label: string,
  members: { kind: string; entityId: string }[],
  createdAt: Date,
): { release: Release; members: ReleaseMember[] } {
  return {
    release: { id, label, createdAt, frozen: false },
    members: members.map((m) => ({ releaseId: id, kind: m.kind, entityId: m.entityId })),
  };
}

/**
 * Point-in-time resolution: which entity id of `kind` did `release` pin? Returns the
 * pinned id, or null if the release did not include that entity. A lesson records its
 * release id, so this reconstructs exactly what was taught (§19).
 */
export function resolveAt(members: ReleaseMember[], releaseId: string, kind: string, entityId: string): string | null {
  const hit = members.find((m) => m.releaseId === releaseId && m.kind === kind && m.entityId === entityId);
  return hit ? hit.entityId : null;
}
