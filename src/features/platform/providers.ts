import { HAS_BACKEND } from "@/features/platform/config";
import { teachingService } from "@/features/platform/services/teachingService";
import { workspaceService } from "@/features/platform/services/workspaceService";
import { localWorkspacePersistence } from "@/features/workspace/persistence/localStorage";
import type { TeachingProvider } from "@/features/workspace/ai/types";
import type { WorkspacePersistence } from "@/features/workspace/persistence/PersistenceService";

/**
 * Provider selection — the single place the app decides where data comes from.
 *
 * Teaching always flows through the backend service (there is NO in-app mock or
 * lesson generation). Persistence uses the backend when configured, otherwise the
 * local (offline) cache so the canvas still restores between reloads.
 */
export const teachingProvider: TeachingProvider = teachingService;

export const workspacePersistence: WorkspacePersistence = HAS_BACKEND
  ? workspaceService
  : localWorkspacePersistence;
