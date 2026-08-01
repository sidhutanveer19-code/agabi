/**
 * Composite workspace/canvas storage keys. A Workspace row's `id` is
 * `${userId}:${canvasId}`; `userId` is also stored as its own column. These two
 * helpers are the ONLY place that composition/decomposition happens, so the two
 * directions can never disagree.
 *
 * `bareId` strips by `userId.length + 1` (NOT `split(":")`) so it round-trips even
 * when a userId itself contains a colon — the caller always holds the exact userId.
 * Proven by ids.test.ts, including a colon-containing userId.
 */
export const storageId = (userId: string, canvasId: string) => `${userId}:${canvasId}`;

export const bareId = (userId: string, storage: string) => storage.slice(userId.length + 1);
