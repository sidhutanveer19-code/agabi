import type { Camera, Region, Size } from "@/features/workspace/types";
import { fitRect } from "@/features/workspace/camera/cameraMath";
import { unionRects } from "@/features/workspace/utils/geometry";

/** Camera that frames every region (null if the workspace is empty). */
export function fitAllCamera(regions: Region[], viewport: Size): Camera | null {
  const union = unionRects(
    regions.map((r) => ({ x: r.position.x, y: r.position.y, w: r.size.w, h: r.size.h }))
  );
  return union ? fitRect(union, viewport, 120) : null;
}

/** Camera that frames a single region (used to navigate to an explanation). */
export function regionCamera(region: Region, viewport: Size): Camera {
  return fitRect(
    { x: region.position.x, y: region.position.y, w: region.size.w, h: region.size.h },
    viewport,
    120
  );
}
