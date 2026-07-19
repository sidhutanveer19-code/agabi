"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// NOTE: block registration is intentionally NOT global — the frozen pre-workspace
// product ships no blocks, so the manifest must not bloat the main-route bundle.
// The gallery route registers blocks itself; the Learning Workspace will register
// them in its own route when that phase begins.

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
