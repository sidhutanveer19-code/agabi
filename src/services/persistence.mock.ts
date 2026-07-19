import type { WorkspaceDoc } from "@/workspace/blocks";
import type { PersistenceService } from "./types";

const key = (id: string) => `agabi:ws:${id}`;

/** localStorage-backed persistence mock. Swap for an API without touching callers. */
export class LocalPersistenceService implements PersistenceService {
  async save(doc: WorkspaceDoc): Promise<void> {
    try {
      window.localStorage.setItem(key(doc.id), JSON.stringify(doc));
    } catch {
      /* storage unavailable */
    }
  }
  async load(id: string): Promise<WorkspaceDoc | null> {
    try {
      const raw = window.localStorage.getItem(key(id));
      return raw ? (JSON.parse(raw) as WorkspaceDoc) : null;
    } catch {
      return null;
    }
  }
}
