import type { CSSProperties, ReactNode } from "react";
import { Surface } from "@/design-system/primitives/Surface";
import { Chip } from "@/design-system/primitives/atoms";

/** Consistent chrome for content blocks: a raised surface with an optional eyebrow. */
export function BlockCard({
  eyebrow,
  accent,
  pad = 18,
  style,
  children,
}: {
  eyebrow?: string;
  accent?: string;
  pad?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Surface variant="raised" pad={pad} style={{ width: "100%", ...style }}>
      {eyebrow && (
        <div style={{ marginBottom: 10 }}>
          <Chip tone={accent}>{eyebrow}</Chip>
        </div>
      )}
      {children}
    </Surface>
  );
}
