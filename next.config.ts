import type { NextConfig } from "next";

/**
 * Content-Security-Policy — shipped in **Report-Only** mode.
 *
 * A frontend that renders AI-streamed blocks (iframes, media, KaTeX/Mermaid HTML,
 * Monaco/Three/MapLibre workers, the react-pdf worker from cdnjs) needs a CSP, but
 * enforcing one blind — before real backend/tile domains are known and violation
 * reporting is wired — would risk breaking blocks that can't all be browser-verified
 * here. Report-Only is the correct rollout stage: the policy is present and tuned,
 * surfaces violations without blocking, and flips to enforcing (drop `-Report-Only`)
 * once the allowed origins are pinned and a report endpoint exists.
 */
const csp = [
  "default-src 'self'",
  // Next.js hydration uses inline scripts; Monaco/pdf.js workers need eval + blob.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdnjs.cloudflare.com",
  "worker-src 'self' blob: https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  // API base + map tiles + other https resources the blocks fetch.
  "connect-src 'self' https: blob:",
  // Embed block iframes (already scheme-guarded to https by safeUrl).
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: csp },
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
