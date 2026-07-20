import type { StudentEvent } from "@contract";
import { HAS_BACKEND } from "@/features/platform/config";
import { eventService } from "@/features/platform/services/eventService";

/**
 * Observation event bus. The frontend only *emits* — it never interprets. Events
 * are batched and flushed asynchronously so they never block the UI, and dropped
 * silently on failure (observation is best-effort). No-op when no backend.
 */
let queue: StudentEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 4000;
const MAX_BATCH = 20;

async function flush(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await eventService.send(batch);
  } catch {
    /* best-effort — never resurface observation failures to the student */
  }
}

function schedule(): void {
  if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
}

export const eventBus = {
  emit(type: string, payload?: Record<string, unknown>, workspaceId?: string): void {
    if (!HAS_BACKEND) return;
    queue.push({ type, ts: Date.now(), workspaceId, payload });
    if (queue.length >= MAX_BATCH) void flush();
    else schedule();
  },
};

// Flush trailing events when the tab is hidden/closed.
if (typeof window !== "undefined") {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}
