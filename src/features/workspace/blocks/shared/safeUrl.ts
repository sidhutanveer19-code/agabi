/**
 * safeUrl — scheme allowlist guard for every block URL input.
 *
 * Block `data` (iframe src, media src, image src, pdf href) can originate from an
 * AI-generated stream, so it is untrusted. This guard permits only safe schemes
 * per sink kind and rejects `javascript:`, `data:text/html`, `file:`, `vbscript:`,
 * protocol-relative (`//host`), etc. Returns the original string when safe, else
 * `null` so the caller can render a placeholder instead of an attack surface.
 *
 *  - "frame": iframe src — https/http only (strictest; no blob/data/relative).
 *  - "media": <video>/<audio>/pdf — http(s) + blob: (object URLs) + same-origin relative.
 *  - "image": <img> — http(s) + blob: + inline `data:image/*` + same-origin relative.
 */
export type UrlKind = "frame" | "media" | "image";

const SCHEMES: Record<UrlKind, readonly string[]> = {
  frame: ["http:", "https:"],
  media: ["http:", "https:", "blob:"],
  image: ["http:", "https:", "blob:", "data:"],
};

export function safeUrl(raw: string | null | undefined, kind: UrlKind = "media"): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Same-origin relative paths ("/x", "./x", "../x") are safe for media/images
  // (passive resource loads), never for frames.
  if (/^\.{0,2}\//.test(s) && !/^\/\//.test(s)) {
    return kind === "frame" ? null : s;
  }

  let protocol: string;
  try {
    protocol = new URL(s).protocol.toLowerCase();
  } catch {
    return null; // unparseable or protocol-relative → reject
  }

  if (kind === "image" && protocol === "data:") {
    return /^data:image\//i.test(s) ? s : null; // inline images only, never data:text/html
  }

  return SCHEMES[kind].includes(protocol) ? s : null;
}
