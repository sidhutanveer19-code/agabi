"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { LearningWorkspace } from "@/features/workspace/LearningWorkspace";

/**
 * A single canvas. The URL is the state: the id lives in the path, so a refresh
 * resumes THIS canvas (no accidental new canvas) and the back button works. `goal`
 * (a query param, present only when arriving fresh from "/") seeds the first lesson;
 * on a reload it's absent and the saved doc is restored instead. `key={id}` forces a
 * clean remount when switching canvases.
 */
export default function CanvasPage() {
  const { id } = useParams<{ id: string }>();
  const goal = useSearchParams().get("goal") ?? undefined;
  const router = useRouter();

  return (
    <div style={{ position: "fixed", inset: 0, background: "#06070c", overflow: "hidden" }}>
      <LearningWorkspace key={id} canvasId={id} goal={goal} onExit={() => router.push("/")} />
    </div>
  );
}
