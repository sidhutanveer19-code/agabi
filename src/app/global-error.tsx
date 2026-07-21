"use client";

/**
 * Global error boundary (Next App Router). Unlike `error.tsx`, this catches
 * crashes thrown by the root `layout.tsx` / providers themselves — the last line
 * of defense against a white screen. It must render its own <html>/<body> because
 * it replaces the root layout, and uses inline colors since token CSS may not be
 * mounted when the layout is what failed.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div
          role="alert"
          style={{
            position: "fixed",
            inset: 0,
            background: "#06070c",
            color: "#f3eee6",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 28,
            textAlign: "center",
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ fontSize: 28, color: "#f6f1e9" }}>Agabi needs to reload.</div>
          <div style={{ color: "#8b8579", fontSize: 14, maxWidth: "44ch", lineHeight: 1.6 }}>
            An unexpected error interrupted the app. Your saved work is intact — reload to continue.
          </div>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 6,
              padding: "10px 20px",
              borderRadius: 12,
              border: "1px solid rgba(167,139,250,.4)",
              background: "rgba(167,139,250,.14)",
              color: "#f6f1e9",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
