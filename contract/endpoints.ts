/**
 * The complete Agabi API surface — deliberately minimal. Every endpoint exists
 * because a real frontend interaction requires it. Nothing is added "because it
 * might be useful". Paths are relative to the API base URL.
 */
export const ENDPOINTS = {
  /** Stream a lesson for ONE canvas (topic entry / interrupt / question). canvasId is a
   *  required path segment — the canvas is the memory boundary. Backend: Teaching Engine + AI Gateway. */
  canvasTeach: (canvasId: string) => ({
    method: "POST",
    path: `/api/canvas/${encodeURIComponent(canvasId)}/teach`,
  }),

  /** Load / autosave a workspace. Backend: Workspace Platform · Persistence. */
  workspace: (id: string) => ({
    get: { method: "GET", path: `/api/workspace/${encodeURIComponent(id)}` },
    put: { method: "PUT", path: `/api/workspace/${encodeURIComponent(id)}` },
  }),

  /** List the user's canvases (summaries only) for the sidebar. Backend: Workspace Platform. */
  canvases: { method: "GET", path: "/api/workspace" as const },

  /** Emit student actions (batched). Backend: Observation Engine · Event Log. */
  events: { method: "POST", path: "/api/events" as const },

  /** Identify the student on load (cookie auth). Backend: Student Platform · Auth. */
  session: { method: "GET", path: "/api/session" as const },
} as const;

/**
 * Backend-owned but NOT exposed as endpoints yet — no current frontend interaction
 * renders them, so they are not added (smallest correct API). Introduce only when a
 * real rendering surface needs them:
 *   - retrieval     (internal to /teach)
 *   - student-state (mastery / memory / digital-twin)
 *   - recommendations
 */
export const RESERVED_ENDPOINTS = ["retrieval", "student-state", "recommendations"] as const;
