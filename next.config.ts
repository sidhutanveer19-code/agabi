import type { NextConfig } from "next";

/**
 * Content-Security-Policy.
 *
 * **Enforced in production**, Report-Only in development (so Turbopack HMR's
 * ws:/localhost connections aren't blocked while iterating). `connect-src` is
 * pinned to the app origin plus the configured backend origin
 * (`NEXT_PUBLIC_API_BASE_URL`) — so enforcement works without knowing the final
 * public domain: whatever origin the app is told to call is exactly what the CSP
 * allows. `img/media/frame` stay `https:`-broad (block content loads passive
 * resources / scheme-guarded embeds from arbitrary https hosts).
 */
const isProd = process.env.NODE_ENV === "production";

let apiOrigin = "";
try {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (base) apiOrigin = new URL(base).origin;
} catch {
  apiOrigin = "";
}

const connectSrc = [
  "'self'",
  "blob:",
  apiOrigin,
  // Dev only: HMR websocket + localhost backend (Report-Only there anyway).
  isProd ? "" : "ws: wss: http://localhost:* http://127.0.0.1:*",
]
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  // Next.js hydration uses inline scripts; Monaco/pdf.js workers need eval + blob.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdnjs.cloudflare.com",
  "worker-src 'self' blob: https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  // Embed block iframes (already scheme-guarded to https by safeUrl).
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  {
    key: isProd ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    value: csp,
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The Agabi app itself must never be framed (clickjacking defense).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Speech features use the mic; deny the rest by default.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
