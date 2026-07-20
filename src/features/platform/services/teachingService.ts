import { ENDPOINTS, teachEventSchema, type TeachRequest, type TeachContext, type TeachEvent } from "@contract";
import { apiClient } from "@/features/platform/client/apiClient";
import { ndjsonStream } from "@/features/platform/client/streamClient";
import type { TeachingProvider } from "@/features/workspace/ai/types";

/**
 * Real teaching service — POSTs to `/teach` and yields validated `TeachEvent`s
 * from the NDJSON stream. Implements the workspace's `TeachingProvider`, so it
 * drops straight into `useTeaching` with no UI change. The backend does all
 * generation; this only relays.
 */
export const teachingService: TeachingProvider = {
  async *teach(req: TeachRequest, context: TeachContext, signal: AbortSignal): AsyncGenerator<TeachEvent> {
    const res = await apiClient.postStream(ENDPOINTS.teach.path, { request: req, context }, signal);
    for await (const raw of ndjsonStream(res, signal)) {
      const parsed = teachEventSchema.safeParse(raw);
      if (parsed.success) yield parsed.data;
      // malformed events are dropped, not fatal
    }
  },
};
