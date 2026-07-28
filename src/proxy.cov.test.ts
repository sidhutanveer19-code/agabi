import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { NextFetchEvent } from "next/server";

/**
 * middleware (src/proxy.ts) — the third of the three AUTH_MODE switches.
 *
 * This suite drives the REAL middleware end to end. It fakes ONLY the true external
 * edge (§H1.7): the `@clerk/nextjs/server` package, whose `clerkMiddleware` is a
 * third-party factory that boots Clerk. Everything the file itself owns — the
 * `AUTH_MODE === "clerk"` branch, the lazy dynamic import, the `NextResponse.next()`
 * dev path, the exact argument forwarding, and the `config.matcher` shape — is exercised
 * for real.
 *
 * The clerk edge is asserted at the seam: `clerkMiddleware()` is called with NO args and
 * the handler it returns is invoked with the EXACT `(req, ev)` the middleware received,
 * and its result is returned verbatim (identity), proving the middleware neither rewraps
 * nor swallows Clerk's response.
 */

const { clerkMiddlewareMock, clerkHandlerMock } = vi.hoisted(() => {
  const clerkHandlerMock = vi.fn();
  const clerkMiddlewareMock = vi.fn(() => clerkHandlerMock);
  return { clerkMiddlewareMock, clerkHandlerMock };
});

vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: clerkMiddlewareMock }));

import middleware, { config } from "@/proxy";

// ── helpers ──────────────────────────────────────────────────────────────────
function req(path = "/dashboard"): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}
/** `ev` is opaque to the middleware — a sentinel proves exact forwarding. */
function fetchEvent(): NextFetchEvent {
  return { sentinel: "fetch-event" } as unknown as NextFetchEvent;
}

const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;

beforeEach(() => {
  // Keep clerkMiddlewareMock's `() => clerkHandlerMock` impl (mockClear, not mockReset),
  // but wipe call history so "not.toHaveBeenCalled" is meaningful per test.
  clerkMiddlewareMock.mockClear();
  clerkHandlerMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_AUTH_MODE === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = ORIGINAL_AUTH_MODE;
});

describe("middleware — clerk branch (AUTH_MODE === 'clerk')", () => {
  it("delegates to clerkMiddleware()(req, ev) and returns its result verbatim", async () => {
    process.env.AUTH_MODE = "clerk";
    const sentinel = new Response("clerk-handled", { status: 302 });
    clerkHandlerMock.mockReturnValue(sentinel);

    const r = req("/api/teach");
    const ev = fetchEvent();
    const result = await middleware(r, ev);

    // The factory is invoked exactly once, with NO arguments (`clerkMiddleware()`).
    expect(clerkMiddlewareMock).toHaveBeenCalledTimes(1);
    expect(clerkMiddlewareMock).toHaveBeenCalledWith();

    // The handler it returns receives the EXACT req + ev the middleware was given.
    expect(clerkHandlerMock).toHaveBeenCalledTimes(1);
    expect(clerkHandlerMock).toHaveBeenCalledWith(r, ev);

    // The middleware returns Clerk's response unchanged (identity, not a copy).
    expect(result).toBe(sentinel);
    // And it did NOT fall through to the dev NextResponse.next() path.
    expect((result as Response).headers.get("x-middleware-next")).toBeNull();
  });

  it("awaits and forwards an async (promise-returning) Clerk handler result", async () => {
    process.env.AUTH_MODE = "clerk";
    const sentinel = new Response(null, { status: 401 });
    clerkHandlerMock.mockResolvedValue(sentinel);

    const result = await middleware(req("/api/session"), fetchEvent());

    expect(clerkHandlerMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(sentinel);
  });
});

describe("middleware — dev branch (AUTH_MODE !== 'clerk')", () => {
  it("returns NextResponse.next() and never loads Clerk", async () => {
    process.env.AUTH_MODE = "dev";

    const result = await middleware(req("/dashboard"), fetchEvent());

    // NextResponse.next() → 200 with the edge-runtime continue header.
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(200);
    expect((result as Response).headers.get("x-middleware-next")).toBe("1");

    // The whole point of the file: Clerk is never imported/invoked in dev.
    expect(clerkMiddlewareMock).not.toHaveBeenCalled();
    expect(clerkHandlerMock).not.toHaveBeenCalled();
  });

  // The comparison is an EXACT `=== "clerk"`. Every near-miss must take the dev path —
  // this is what kills string-literal / case / operator mutants of the guard.
  it.each([
    ["undefined (env unset)", undefined],
    ["empty string", ""],
    ["dev", "dev"],
    ["production", "production"],
    ["CLERK (wrong case)", "CLERK"],
    ["Clerk (wrong case)", "Clerk"],
    ["clerk with trailing space", "clerk "],
    ["clerk with leading space", " clerk"],
    ["clerkx (superstring)", "clerkx"],
  ])("AUTH_MODE=%s takes the dev branch (continue header, no Clerk)", async (_label, mode) => {
    if (mode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = mode;

    const result = await middleware(req("/x"), fetchEvent());

    expect((result as Response).headers.get("x-middleware-next")).toBe("1");
    expect(clerkMiddlewareMock).not.toHaveBeenCalled();
  });
});

describe("config.matcher", () => {
  it("exposes exactly two matcher entries", () => {
    expect(Array.isArray(config.matcher)).toBe(true);
    expect(config.matcher).toHaveLength(2);
  });

  it("first entry is the exact static-asset-excluding pattern", () => {
    expect(config.matcher[0]).toBe(
      "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    );
  });

  it("second entry targets the api and trpc route trees exactly", () => {
    expect(config.matcher[1]).toBe("/(api|trpc)(.*)");
  });

  it("first entry is a valid RegExp whose semantics run middleware on app + api routes", () => {
    expect(() => new RegExp(config.matcher[0])).not.toThrow();
    // Next compiles the matcher as a full-path match; assert the pattern's own semantics.
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/dashboard")).toBe(true);
    expect(re.test("/api/teach")).toBe(true);
  });

  it("first entry excludes _next internals and static asset extensions", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/_next/static/chunk-abc.js")).toBe(false);
    expect(re.test("/logo.png")).toBe(false);
    expect(re.test("/styles.css")).toBe(false);
    expect(re.test("/app.js")).toBe(false);
    expect(re.test("/font.woff2")).toBe(false);
    expect(re.test("/icon.ico")).toBe(false);
  });

  it("first entry still runs middleware on .json (js(?!on) negative lookahead)", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    // .json must NOT be excluded — API JSON responses must pass through middleware.
    expect(re.test("/data.json")).toBe(true);
  });

  it("second entry matches api/trpc paths and not unrelated ones", () => {
    const re = new RegExp(`^${config.matcher[1]}$`);
    expect(re.test("/api/session")).toBe(true);
    expect(re.test("/trpc/anything")).toBe(true);
    expect(re.test("/dashboard")).toBe(false);
  });
});
