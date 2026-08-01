import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentReport } from "@/server/health";

/**
 * GET /api/health — the subsystem report route.
 *
 * This suite drives the REAL route end to end: real ?deep parsing, real aggregate
 * wiring, real httpOk mapping, real JSON serialization (incl. the deep-only pretty
 * indent), real headers. It fakes ONLY the two edges the route legitimately cannot
 * own in a node unit (§H1.7 — fake at the I/O boundary, keep logic real):
 *   • checkAll     — runs LIVE Postgres health probes (the I/O edge).
 *   • providerChain — builds AI-SDK model handles from env keys (the config edge).
 *
 * `aggregate` is PURE LOGIC, so it is kept REAL — a spy that DELEGATES to the real
 * implementation on every test — except the two cases that must feed the route a
 * status the real aggregate can never emit (INSUFFICIENT_DATA / NOT_INSTALLED) in
 * order to prove the route's HTTP mapping for those exact `overall.status` branches.
 */

const health = vi.hoisted(() => ({ checkAll: vi.fn() }));
vi.mock("@/server/health", async (importActual) => {
  const actual = await importActual<typeof import("@/server/health")>();
  // Keep the real aggregate (pure logic) behind a spy so most tests exercise it for
  // real and two tests can override its return once.
  return { ...actual, checkAll: health.checkAll, aggregate: vi.fn(actual.aggregate) };
});

const advisors = vi.hoisted(() => ({ providerChain: vi.fn() }));
vi.mock("@/server/advisors/providers", () => ({ providerChain: advisors.providerChain }));

import { aggregate } from "@/server/health";
const { GET, runtime, dynamic } = await import("@/app/api/health/route");

// ── helpers ──────────────────────────────────────────────────────────────────
function comp(status: ComponentReport["status"], over: Partial<ComponentReport> = {}): ComponentReport {
  return { name: "c", kind: "engine", dependencies: [], status, reason: status, ...over };
}
function req(query = ""): Request {
  return new Request(`http://localhost/api/health${query}`);
}
/** The route reads only `.name` off each provider entry. */
function chain(...names: string[]): { name: string }[] {
  return names.map((name) => ({ name }));
}

beforeEach(() => {
  health.checkAll.mockReset();
  health.checkAll.mockResolvedValue([comp("UP")]);
  advisors.providerChain.mockReset();
  advisors.providerChain.mockReturnValue(chain("groq:llama-3.3-70b-versatile"));
  vi.mocked(aggregate).mockClear(); // clear call history; keep the real delegating impl
});

describe("GET /api/health — module surface", () => {
  it("runs on the nodejs runtime and is force-dynamic (never statically cached)", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("exports GET as a function", () => {
    expect(typeof GET).toBe("function");
  });
});

describe("GET /api/health — the ?deep flag (shallow by default, live + pretty when =1)", () => {
  it("?deep=1 runs the deep checks AND pretty-prints with a 2-space indent", async () => {
    const res = await GET(req("?deep=1"));

    expect(health.checkAll).toHaveBeenCalledWith({ deep: true });
    const text = await res.text();
    expect(text).toMatch(/\n {2}"status"/); // exactly 2 leading spaces → 2-space indent, multi-line
    expect(JSON.parse(text).status).toBe("UP"); // still valid JSON
  });

  it("no deep param → shallow checks and COMPACT single-line JSON (indent 0, no newlines)", async () => {
    const res = await GET(req());

    expect(health.checkAll).toHaveBeenCalledWith({ deep: false });
    const text = await res.text();
    expect(text).not.toContain("\n");
    expect(JSON.parse(text).status).toBe("UP");
  });

  it('?deep=0 is NOT deep (only the exact string "1" enables it)', async () => {
    const res = await GET(req("?deep=0"));

    expect(health.checkAll).toHaveBeenCalledWith({ deep: false });
    expect(await res.text()).not.toContain("\n");
  });

  it('?deep=true is NOT deep (guards === "1" equality, not mere truthiness)', async () => {
    const res = await GET(req("?deep=true"));

    expect(health.checkAll).toHaveBeenCalledWith({ deep: false });
    expect(await res.text()).not.toContain("\n");
  });
});

describe("GET /api/health — HTTP status mapping (200 for servable states, 503 otherwise)", () => {
  it("UP (all healthy, chain present) → 200", async () => {
    health.checkAll.mockResolvedValue([comp("UP"), comp("NOT_INSTALLED", { name: "ingestion" })]);
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("UP");
  });

  it("DEGRADED (a component degraded) → 200 (still servable)", async () => {
    health.checkAll.mockResolvedValue([comp("DEGRADED")]);
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("DEGRADED");
  });

  it("DOWN (a core infrastructure component down) → 503", async () => {
    health.checkAll.mockResolvedValue([comp("DOWN", { kind: "infrastructure", name: "database" })]);
    const res = await GET(req());

    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe("DOWN");
  });

  it("UNSAFE (evidence untrustworthy — refuse) → 503", async () => {
    health.checkAll.mockResolvedValue([comp("UNSAFE")]);
    const res = await GET(req());

    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe("UNSAFE");
  });

  it("INSUFFICIENT_DATA → 200 (a still-warming predictor is servable)", async () => {
    // Real aggregate never emits this — override the spy once to hit the route's third OR arm.
    vi.mocked(aggregate).mockReturnValueOnce({ status: "INSUFFICIENT_DATA", reason: "baseline warming up" });
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "INSUFFICIENT_DATA", reason: "baseline warming up" });
  });

  it("NOT_INSTALLED (not among the servable set) → 503", async () => {
    vi.mocked(aggregate).mockReturnValueOnce({ status: "NOT_INSTALLED", reason: "engine unbuilt" });
    const res = await GET(req());

    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe("NOT_INSTALLED");
  });
});

describe("GET /api/health — the empty-provider-chain signal the walled health providers can't see", () => {
  it("no providers → aggregate is told emptyProviderChain:true → DEGRADED 'no model provider configured' at 200", async () => {
    const reports = [comp("UP")];
    health.checkAll.mockResolvedValue(reports);
    advisors.providerChain.mockReturnValue([]); // empty chain, everything else healthy

    const res = await GET(req());

    expect(vi.mocked(aggregate)).toHaveBeenCalledWith(reports, { emptyProviderChain: true });
    const body = await res.json();
    expect(body.status).toBe("DEGRADED");
    expect(body.reason).toBe("no model provider configured"); // proves the real aggregate ran
    expect(body.providers).toEqual([]);
    expect(res.status).toBe(200);
  });

  it("providers present → emptyProviderChain:false, and an all-UP graph stays UP", async () => {
    const reports = [comp("UP")];
    health.checkAll.mockResolvedValue(reports);
    advisors.providerChain.mockReturnValue(chain("google:gemini-2.0-flash", "groq:llama-3.3-70b-versatile"));

    const res = await GET(req());

    expect(vi.mocked(aggregate)).toHaveBeenCalledWith(reports, { emptyProviderChain: false });
    const body = await res.json();
    expect(body.status).toBe("UP");
    expect(body.providers).toEqual(["google:gemini-2.0-flash", "groq:llama-3.3-70b-versatile"]);
  });
});

describe("GET /api/health — the full report body", () => {
  it("carries status, reason, the provider names, the component reports, and a fresh ts", async () => {
    const reports = [
      comp("UP", { name: "knowledge-store", kind: "engine", latencyMs: 4 }),
      comp("NOT_INSTALLED", { name: "ingestion" }),
    ];
    health.checkAll.mockResolvedValue(reports);
    advisors.providerChain.mockReturnValue(chain("groq:llama-3.3-70b-versatile"));

    const before = Date.now();
    const res = await GET(req());
    const after = Date.now();
    const body = await res.json();

    expect(body.status).toBe("UP");
    expect(body.reason).toBe("all real components healthy"); // real aggregate's UP reason, verbatim
    expect(body.providers).toEqual(["groq:llama-3.3-70b-versatile"]);
    expect(body.components).toEqual(reports); // the exact checkAll output, unmodified
    expect(typeof body.ts).toBe("number");
    expect(body.ts).toBeGreaterThanOrEqual(before);
    expect(body.ts).toBeLessThanOrEqual(after);
  });

  it("passes the SAME reports array through to aggregate and back out as components (no re-derivation)", async () => {
    const reports = [comp("DEGRADED", { name: "detector", errorRate: 0.2 })];
    health.checkAll.mockResolvedValue(reports);

    const res = await GET(req("?deep=1"));
    const body = await res.json();

    expect(body.components).toEqual(reports);
    expect(body.status).toBe("DEGRADED");
  });
});

describe("GET /api/health — response headers (never cached, always JSON)", () => {
  it("content-type application/json + cache-control no-store on BOTH a 200 and a 503", async () => {
    const ok = await GET(req());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/json");
    expect(ok.headers.get("cache-control")).toBe("no-store");

    health.checkAll.mockResolvedValue([comp("UNSAFE")]);
    const bad = await GET(req());
    expect(bad.status).toBe(503);
    expect(bad.headers.get("content-type")).toBe("application/json");
    expect(bad.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/health — error surface", () => {
  it("does NOT swallow a checkAll failure — the route adds no masking try/catch (per-provider catch lives in checkAll)", async () => {
    health.checkAll.mockRejectedValue(new Error("probe pool exhausted"));
    await expect(GET(req())).rejects.toThrow("probe pool exhausted");
  });
});
