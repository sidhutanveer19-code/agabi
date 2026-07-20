import { ENDPOINTS, sessionSchema, type Session } from "@contract";
import { apiClient } from "@/features/platform/client/apiClient";

/** Loads the current student session (httpOnly cookie auth). */
export const sessionService = {
  async get(signal?: AbortSignal): Promise<Session> {
    const raw = await apiClient.getJson<unknown>(ENDPOINTS.session.path, signal);
    return sessionSchema.parse(raw);
  },
};
