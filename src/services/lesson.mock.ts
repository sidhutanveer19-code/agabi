import type { WorkspaceDoc } from "@/workspace/blocks";
import { buildWorkspace } from "./composer";
import type { Depth, LessonService } from "./types";

/** Mock composer. Replace with an API-backed impl; the interface stays identical. */
export class MockLessonService implements LessonService {
  async composeWorkspace(topic: string, depth: Depth = "normal"): Promise<WorkspaceDoc> {
    await new Promise((r) => setTimeout(r, 240)); // simulate latency
    return buildWorkspace(topic, depth);
  }
}
