import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * db.ts — the Prisma singleton. Two branches on each of two operators, so four
 * real paths, all exercised here:
 *   1. `globalForPrisma.prisma ?? new PrismaClient()`
 *        - LEFT  (global already set) → REUSE, construct nothing.
 *        - RIGHT (global undefined)   → construct exactly one fresh PrismaClient.
 *   2. `if (process.env.NODE_ENV !== "production")`
 *        - TRUE  (dev/test) → cache the singleton back onto globalThis.
 *        - FALSE (production) → skip the cache; globalThis stays untouched.
 *
 * The ONLY I/O edge — the `PrismaClient` constructor — is stubbed with a tagged
 * class + a shared construction counter, so every assertion is on the module's
 * OWN logic: which instance it exports (identity), whether it constructed, and
 * whether it wrote the singleton back to globalThis. The module runs all of its
 * work at import time, so each case does `vi.resetModules()` + a fresh dynamic
 * import to re-execute it under a controlled (globalThis.prisma, NODE_ENV) state.
 */

const h = vi.hoisted(() => ({ constructCount: 0 }));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    readonly __brand = "fresh-prisma";
    constructor() {
      h.constructCount += 1;
    }
  },
}));

type GlobalWithPrisma = { prisma?: unknown };
const g = globalThis as unknown as GlobalWithPrisma;

// This project narrows `process.env.NODE_ENV` to a read-only literal union, so route
// writes through a mutable view of the env bag (still the real process.env object).
const env = process.env as unknown as Record<string, string | undefined>;

/** Re-execute db.ts from scratch under the currently-set globals. */
async function loadDb(): Promise<{ prisma: unknown }> {
  vi.resetModules();
  return import("@/server/db");
}

let savedNodeEnv: string | undefined;

beforeEach(() => {
  h.constructCount = 0;
  savedNodeEnv = env.NODE_ENV;
  delete g.prisma;
});

afterEach(() => {
  if (savedNodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = savedNodeEnv;
  delete g.prisma;
  vi.resetModules();
});

describe("db — fresh construction path (?? right branch)", () => {
  it("no global + non-production → constructs ONE fresh PrismaClient and caches it on globalThis", async () => {
    delete g.prisma;
    env.NODE_ENV = "development";

    const { prisma } = await loadDb();

    expect(h.constructCount).toBe(1);
    expect((prisma as { __brand?: string }).__brand).toBe("fresh-prisma");
    // non-production TRUE branch → the exported instance is written back to globalThis
    expect(g.prisma).toBe(prisma);
  });

  it("no global + production → constructs ONE fresh PrismaClient but does NOT cache it (if false branch)", async () => {
    delete g.prisma;
    env.NODE_ENV = "production";

    const { prisma } = await loadDb();

    expect(h.constructCount).toBe(1);
    expect((prisma as { __brand?: string }).__brand).toBe("fresh-prisma");
    // production FALSE branch → globalThis is never assigned, stays undefined
    expect(g.prisma).toBeUndefined();
  });
});

describe("db — reuse path (?? left branch)", () => {
  it("existing global + non-production → REUSES it, constructs nothing, leaves global as-is", async () => {
    const preset = { __brand: "preset-singleton" };
    g.prisma = preset;
    env.NODE_ENV = "development";

    const { prisma } = await loadDb();

    expect(h.constructCount).toBe(0);
    expect(prisma).toBe(preset);
    // TRUE branch reassigns global to the same instance it already held → still preset
    expect(g.prisma).toBe(preset);
  });

  it("existing global + production → reuses it, constructs nothing, no reassignment", async () => {
    const preset = { __brand: "preset-prod" };
    g.prisma = preset;
    env.NODE_ENV = "production";

    const { prisma } = await loadDb();

    expect(h.constructCount).toBe(0);
    expect(prisma).toBe(preset);
    expect(g.prisma).toBe(preset);
  });
});

describe("db — NODE_ENV boundary is exact string 'production'", () => {
  it("empty-string NODE_ENV is NOT production → still caches (non-production branch)", async () => {
    delete g.prisma;
    env.NODE_ENV = "";

    const { prisma } = await loadDb();

    expect(h.constructCount).toBe(1);
    // "" !== "production" → true branch → cached
    expect(g.prisma).toBe(prisma);
  });
});
