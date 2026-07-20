"use client";

import { useCallback } from "react";
import type { Region, Size } from "@/features/workspace/types";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useCameraStore } from "@/features/workspace/stores/camera.store";
import { animateCamera } from "@/features/workspace/camera/animateTo";
import { fitAllCamera, regionCamera } from "./navigation";

/** Animated camera navigation (fit-all + go-to-region), reduced-motion aware. */
export function useCameraNavigation(viewport: Size) {
  const setCamera = useCameraStore((s) => s.setCamera);
  const reduced = useReducedMotion();

  const fitAll = useCallback(
    (regions: Region[]) => {
      const target = fitAllCamera(regions, viewport);
      if (target) {
        animateCamera(() => useCameraStore.getState().camera, setCamera, target, { reduced });
      }
    },
    [viewport, setCamera, reduced]
  );

  const goTo = useCallback(
    (region: Region) => {
      const target = regionCamera(region, viewport);
      animateCamera(() => useCameraStore.getState().camera, setCamera, target, { reduced });
    },
    [viewport, setCamera, reduced]
  );

  return { fitAll, goTo };
}
