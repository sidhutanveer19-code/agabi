import { MockLessonService } from "./lesson.mock";
import { LocalPersistenceService } from "./persistence.mock";
import type { Services } from "./types";

let services: Services | null = null;

/** Single access point for all services. Swap the impls here for real APIs. */
export function getServices(): Services {
  if (!services) {
    services = {
      lesson: new MockLessonService(),
      persistence: new LocalPersistenceService(),
    };
  }
  return services;
}

export type { Depth, LessonService, PersistenceService, Services } from "./types";
