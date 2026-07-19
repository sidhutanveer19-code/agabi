import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";
import { color, elevation, radius } from "@/design-system/tokens";

type Variant = "flat" | "raised" | "outline";

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  pad?: number;
  radiusKey?: keyof typeof radius;
}

/** Themed panel. The base container for cards, blocks, popovers. */
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { variant = "flat", pad = 16, radiusKey = "lg", style, children, ...rest },
  ref
) {
  const base: CSSProperties = {
    background: variant === "outline" ? "transparent" : color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius[radiusKey],
    padding: pad,
    boxShadow: variant === "raised" ? elevation[2] : undefined,
  };
  return (
    <div ref={ref} style={{ ...base, ...style }} {...rest}>
      {children}
    </div>
  );
});
