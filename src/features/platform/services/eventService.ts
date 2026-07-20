import { ENDPOINTS, type StudentEvent } from "@contract";
import { apiClient } from "@/features/platform/client/apiClient";

/** Ships batches of observation events to the Event Log. Fire-and-forget. */
export const eventService = {
  async send(events: StudentEvent[]): Promise<void> {
    if (events.length === 0) return;
    await apiClient.postJson(ENDPOINTS.events.path, { events });
  },
};
