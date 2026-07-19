import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { color, font, radius } from "@/design-system/tokens";

/** Uppercase mono eyebrow label. */
export function Chip({
  children,
  tone = color.muted,
  style,
}: {
  children: ReactNode;
  tone?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: font.mono,
        fontSize: 10,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: tone,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Divider({ vertical = false, style }: { vertical?: boolean; style?: CSSProperties }) {
  return (
    <div
      role="separator"
      style={
        vertical
          ? { width: 1, alignSelf: "stretch", background: color.border, ...style }
          : { height: 1, width: "100%", background: color.border, ...style }
      }
    />
  );
}

export function Spinner({ size = 18, tone = color.violet2 }: { size?: number; tone?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="ds-spin"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid ${color.border}`,
        borderTopColor: tone,
        display: "inline-block",
      }}
    />
  );
}

export function Skeleton({ w = "100%", h = 16, style }: { w?: number | string; h?: number; style?: CSSProperties }) {
  return (
    <span
      className="ds-skeleton"
      style={{ display: "block", width: w, height: h, borderRadius: radius.sm, ...style }}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: font.mono,
        fontSize: 11,
        padding: "2px 6px",
        borderRadius: 6,
        border: `1px solid ${color.border}`,
        background: color.surface,
        color: color.inkDim,
      }}
    >
      {children}
    </kbd>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {children}
    </span>
  );
}

/** Styled scroll container. */
export function ScrollArea({ children, style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="ds-scroll" style={{ overflow: "auto", ...style }} {...rest}>
      {children}
    </div>
  );
}
