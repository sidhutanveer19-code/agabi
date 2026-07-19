import type { ReactNode } from "react";

/**
 * Lightweight CSS hover tooltip (no portal/JS). Wrap any control; the tip
 * appears above on hover/focus. Styling lives in `.ds-tip*` (globals.css).
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="ds-tip-wrap">
      {children}
      <span role="tooltip" className="ds-tip">
        {label}
      </span>
    </span>
  );
}
