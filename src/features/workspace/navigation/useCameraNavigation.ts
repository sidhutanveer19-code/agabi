"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Region, Size } from "@/features/workspace/types";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { animateCamera, type AnimateHandle } from "@/features/workspace/camera/animateTo";
import { fitAllCamera, regionCamera } from "@/features/workspace/navigation/navigation";

/**
 * Animated camera navigation: fit-all and fly-to-region. Tweens from the current
 * camera to the target, cancelling any in-flight animation, and jumps instantly
 * when the user prefers reduced motion.
 */
export function useCameraNavigation(viewport: Size) {
  const reduced = useReducedMotion();
  const anim = useRef<AnimateHandle | null>(null);

  const flyTo = useCallback(
    (target: { x: number; y: number; scale: number }) => {
      anim.current?.cancel();
      anim.current = animateCamera(
        useCameraStore.getState().camera,
        target,
        (cam) => useCameraStore.getState().setCamera(cam),
        { reducedMotion: reduced }
      );
    },
    [reduced]
  );

  const fitAll = useCallback(
    (regions: Region[]) => {
      const target = fitAllCamera(regions, viewport);
      if (target) flyTo(target);
    },
    [viewport, flyTo]
  );

  const goTo = useCallback(
    (region: Region) => flyTo(regionCamera(region, viewport)),
    [viewport, flyTo]
  );

  useEffect(() => () => anim.current?.cancel(), []);

  return { fitAll, goTo };
}
