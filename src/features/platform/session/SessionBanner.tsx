"use client";

import { color, font, radius, z as zTokens } from "@/config/tokens";
import { useSession } from "@/features/platform/session/SessionProvider";

/**
 * Shows a calm "session expired" prompt when the backend returns 401. Hidden in
 * every other state (offline / loading / authenticated), so it costs nothing when
 * there's no backend. No login screen is invented — reload re-runs the cookie auth.
 */
export function SessionBanner() {
  const { status } = useSession();
  if (status !== "unauthenticated") return null;

  return (
    <div
      role="alert"
      style={{
        position: "absolute",
        top: 66,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        zIndex: zTokens.overlay,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          borderRadius: radius.pill,
          border: `1px solid ${color.gold2}55`,
          background: "rgba(217,164,65,0.1)",
          backdropFilter: "blur(6px)",
          fontFamily: font.sans,
          fontSize: 13,
          color: color.inkSoft,
        }}
      >
        Your session expired.
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ border: "none", background: color.gold2, color: "#1a1206", borderRadius: radius.sm, padding: "4px 12px", fontSize: 12.5, cursor: "pointer", fontFamily: font.sans, fontWeight: 600 }}
        >
          Sign back in
        </button>
      </div>
    </div>
  );
}
