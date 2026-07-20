let seq = 0;

/** Stable unique id (serialized into the document). */
export function createId(prefix = "id"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  seq += 1;
  return `${prefix}_${seq}_${Date.now()}`;
}

/** Monotonic sequence for ordering (createdAt) without relying on wall-clock ties. */
export function nextSeq(): number {
  seq += 1;
  return seq;
}
