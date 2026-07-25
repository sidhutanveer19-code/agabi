import crypto from "node:crypto";
import { env } from "@/env";

/**
 * Auth seam — dev stub. `getUserId(req)` is the ONLY identity source; Clerk swaps
 * in later by replacing this one function. Identity rides an HMAC-signed cookie so
 * a request can't forge a userId (an unsigned id would let anyone write Event rows
 * or another user's workspace). Signed even in dev.
 */
export const AUTH_COOKIE = "agabi_uid";

function sign(value: string): string {
  return crypto.createHmac("sha256", env.AUTH_SECRET).update(value).digest("base64url");
}

/** Build the signed cookie value `userId.signature`. */
export function signUserId(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

/** Verify a signed cookie value; returns the userId or null. Constant-time. */
export function verifyToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(userId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return userId;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

/** Resolve the authenticated userId from the request, or null if unauthenticated.
 *  AUTH_MODE=clerk swaps identity to Clerk's session (populated by clerkMiddleware in
 *  src/proxy.ts); dev keeps the HMAC-signed cookie. Clerk is imported dynamically and only
 *  in clerk mode, so the dev/test path never loads @clerk/nextjs or needs a request context. */
export async function getUserId(req: Request): Promise<string | null> {
  if (env.AUTH_MODE === "clerk") {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    return userId ?? null;
  }
  return verifyToken(readCookie(req, AUTH_COOKIE));
}

/** Serialize the auth cookie for a Set-Cookie header (httpOnly, lax, 1yr). */
export function authCookieHeader(userId: string): string {
  const value = encodeURIComponent(signUserId(userId));
  const secure = env.NODE_ENV === "production" ? " Secure;" : "";
  return `${AUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=31536000`;
}

/** Mint a fresh anonymous userId (dev: first-visit bootstrap). */
export function newAnonUserId(): string {
  return `dev_${crypto.randomBytes(9).toString("base64url")}`;
}

/**
 * Decide who is teaching, given the resolved cookie userId and the auth mode. In DEV, a request with
 * no session must MINT one inline (a first teach can race ahead of GET /api/session and 401 with a
 * "session expired" banner — this makes that impossible). In CLERK (prod) a missing session stays
 * unauthenticated → real 401. Pure → unit-tested.
 */
export function decideTeachUser(existingUserId: string | null, authMode: string): { userId: string | null; mint: boolean } {
  if (existingUserId) return { userId: existingUserId, mint: false };
  if (authMode === "clerk") return { userId: null, mint: false }; // production must have a real session
  return { userId: null, mint: true }; // dev: mint an anon session inline so teaching never 401s
}
