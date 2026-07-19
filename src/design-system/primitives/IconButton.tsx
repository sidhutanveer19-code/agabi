import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for accessibility — icon-only buttons need a label. */
  label: string;
  active?: boolean;
  size?: number;
}

/** Square icon control (canvas tools, teaching bar). Always labelled for a11y. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, active, size = 42, className, style, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        aria-pressed={active}
        title={label}
        className={cn("ds-ctrl ds-focus", active && "is-active", className)}
        style={{ width: size, height: size, ...style }}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
