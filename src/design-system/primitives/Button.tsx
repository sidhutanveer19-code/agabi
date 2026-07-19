import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { color, font, radius } from "@/design-system/tokens";
import { cn } from "@/lib/cn";

type Variant = "primary" | "soft" | "ghost";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const styles: Record<Variant, CSSProperties> = {
  primary: {
    background: "rgba(167,139,250,.14)",
    border: "1px solid rgba(167,139,250,.4)",
    color: color.inkBright,
  },
  soft: {
    background: color.surface,
    border: `1px solid ${color.border}`,
    color: color.ink,
  },
  ghost: {
    background: "transparent",
    border: "1px solid transparent",
    color: color.muted,
  },
};

/** Primary interactive control. Focus ring + hover come from `.ds-btn`/`.ds-focus`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "soft", size = "md", className, style, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn("ds-btn ds-focus", `ds-btn-${variant}`, className)}
      style={{
        ...styles[variant],
        borderRadius: radius.md,
        padding: size === "sm" ? "7px 12px" : "10px 16px",
        fontSize: size === "sm" ? 12.5 : 14,
        fontFamily: font.sans,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
});
