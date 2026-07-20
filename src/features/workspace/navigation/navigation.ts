import type { Camera, Region, Size } from "@/features/workspace/types";
import { fitRect } from "@/features/workspace/camera/cameraMath";
import { unionRects } from "@/features/workspace/utils/geometry";

/** Camera that frames every region, or null when the workspace is empty. */
export function fitAllCamera(regions: Region[], viewport: Size, padding = 96): Camera | null {
  const rect = unionRects(
    regions.map((r) => ({ x: r.position.x, y: r.position.y, w: r.size.w, h: r.size.h }))
  );
  if (!rect || viewport.w === 0) return null;
  return fitRect(rect, viewport, padding);
}

/** Camera that frames a single region (fly-to target). */
export function regionCamera(region: Region, viewport: Size, padding = 120): Camera {
  return fitRect(
    { x: region.position.x, y: region.position.y, w: region.size.w, h: region.size.h },
    viewport,
    padding
  );
}
