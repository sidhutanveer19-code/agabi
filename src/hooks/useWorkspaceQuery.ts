"use client";

import { useQuery } from "@tanstack/react-query";
import { getServices, type Depth } from "@/services";

/** Declarative, cached composition of a workspace for (topic, depth). */
export function useWorkspaceQuery(topic: string, depth: Depth) {
  return useQuery({
    queryKey: ["workspace", topic, depth],
    queryFn: () => getServices().lesson.composeWorkspace(topic, depth),
    enabled: topic.trim().length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
