import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";

/**
 * Middleware — auth-mode aware (the third of the three switches that must agree).
 *
 * Identity has ONE switch, `AUTH_MODE`, read in three places: `getUserId` (server),
 * `ClerkProvider` (client), and here (middleware). They must agree, or the app half-loads Clerk.
 * `getUserId` already branched and imported Clerk lazily; this file called `clerkMiddleware()`
 * unconditionally at module scope. So dev ran Clerk anyway, and a stale or absent Clerk session
 * produced a 401 "Sign in first" on a path that never wanted Clerk at all.
 *
 * `clerkMiddleware` is imported LAZILY inside the clerk branch rather than at the top of the file,
 * so a dev request never loads `@clerk/nextjs` — the same discipline `server/auth.ts` uses.
 *
 * `process.env` rather than `@/env` is deliberate: middleware runs on the edge runtime and on every
 * request, while `@/env` performs module-scope boot guards that belong on the server, once.
 */
export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  if (process.env.AUTH_MODE === "clerk") {
    const { clerkMiddleware } = await import("@clerk/nextjs/server");
    return clerkMiddleware()(req, ev);
  }
  // Dev: identity is the HMAC-signed anon cookie minted by GET /api/session. Nothing to gate here.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
