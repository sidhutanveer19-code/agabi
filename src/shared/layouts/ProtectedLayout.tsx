import type { ReactNode } from "react";

/**
 * Auth boundary for future authenticated routes. TEMPORARY pass-through:
 * today there is no auth, so it renders children unchanged. When auth lands,
 * the session check + redirect for unauthenticated users goes here — wrapping
 * an authed route's layout with this component is the only change required.
 */
export function ProtectedLayout({ children }: { children: ReactNode }) {
  // TODO(auth): read the session and redirect unauthenticated users to sign-in.
  return <>{children}</>;
}
