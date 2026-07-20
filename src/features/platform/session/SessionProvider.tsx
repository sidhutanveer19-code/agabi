"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@contract";
import { HAS_BACKEND } from "@/features/platform/config";
import { sessionService } from "@/features/platform/services/sessionService";

export type SessionStatus = "offline" | "loading" | "authenticated" | "unauthenticated";

interface SessionCtx {
  session: Session | null;
  status: SessionStatus;
}

const Ctx = createContext<SessionCtx>({ session: null, status: "offline" });

export function useSession(): SessionCtx {
  return useContext(Ctx);
}

/**
 * Loads the student session on mount (cookie auth) and surfaces a 401 as
 * `unauthenticated` (the API client broadcasts `agabi:unauthenticated`). With no
 * backend it stays `offline` and never blocks the app. No login UI is invented —
 * this is the seam a real auth flow plugs into.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>(HAS_BACKEND ? "loading" : "offline");

  useEffect(() => {
    if (!HAS_BACKEND) return;
    let active = true;
    sessionService
      .get()
      .then((s) => { if (active) { setSession(s); setStatus("authenticated"); } })
      .catch(() => { if (active) setStatus("unauthenticated"); });

    const onUnauth = () => { setSession(null); setStatus("unauthenticated"); };
    window.addEventListener("agabi:unauthenticated", onUnauth);
    return () => { active = false; window.removeEventListener("agabi:unauthenticated", onUnauth); };
  }, []);

  return <Ctx.Provider value={{ session, status }}>{children}</Ctx.Provider>;
}
