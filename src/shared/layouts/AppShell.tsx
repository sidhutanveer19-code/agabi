import type { ReactNode } from "react";

/** Shared shell for future authenticated routes: optional header + main region. */
export function AppShell({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      {header && <header className="shrink-0 border-b border-border">{header}</header>}
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
