import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError } from "zod";
import { ENDPOINTS } from "@contract";

/**
 * sessionService.get — loads the current student session over the API client.
 * The ONLY I/O edge (apiClient.getJson → fetch/network) is stubbed; everything
 * asserted here is the module's OWN logic: the exact endpoint path forwarded,
 * the AbortSignal passed through by reference (present vs the default-undefined
 * branch), the REAL zod parse of the returned payload (optional student.name /
 * preferences kept-or-omitted, unknown keys stripped), parse rejection on a bad
 * payload (missing + wrong-typed fields, with the concrete ZodError issue path),
 * and transparent propagation of a getJson rejection (no swallow, no wrap).
 */

const h = vi.hoisted(() => ({
  getJson: (async () => ({})) as (path: string, signal?: AbortSignal) => Promise<unknown>,
}));

vi.mock("@/features/platform/client/apiClient", () => ({
  apiClient: {
    getJson: vi.fn((path: string, signal?: AbortSignal) => h.getJson(path, signal)),
  },
}));

const { sessionService } = await import("@/features/platform/services/sessionService");
const { apiClient } = await import("@/features/platform/client/apiClient");
const getJson = apiClient.getJson as unknown as ReturnType<typeof vi.fn>;

const SESSION_PATH = "/api/session";

beforeEach(() => {
  vi.clearAllMocks();
  h.getJson = async () => ({ student: { id: "s0" } });
});

describe("sessionService.get — success path + zod parse", () => {
  it("sanity: the real endpoint constant is the path we assert against", () => {
    expect(ENDPOINTS.session.path).toBe(SESSION_PATH);
  });

  it("valid full payload → returns the parsed Session verbatim; calls getJson(path, undefined) once", async () => {
    h.getJson = async () => ({ student: { id: "s1", name: "Ada" }, preferences: { theme: "dark" } });

    const res = await sessionService.get();

    expect(res).toEqual({ student: { id: "s1", name: "Ada" }, preferences: { theme: "dark" } });
    expect(getJson).toHaveBeenCalledTimes(1);
    // default-param branch: signal omitted → forwarded as undefined
    expect(getJson).toHaveBeenCalledWith(SESSION_PATH, undefined);
  });

  it("minimal payload (no name, no preferences) → optional keys are OMITTED, not null", async () => {
    h.getJson = async () => ({ student: { id: "s2" } });

    const res = await sessionService.get();

    expect(res).toEqual({ student: { id: "s2" } });
    expect("name" in res.student).toBe(false);
    expect("preferences" in res).toBe(false);
  });

  it("unknown extra keys (top-level AND inside student) are stripped by the schema", async () => {
    h.getJson = async () => ({
      student: { id: "s3", name: "Bo", role: "admin" },
      preferences: { locale: "en", nested: { deep: [1, 2] } },
      csrf: "leak",
    });

    const res = await sessionService.get();

    expect(res).toEqual({ student: { id: "s3", name: "Bo" }, preferences: { locale: "en", nested: { deep: [1, 2] } } });
    expect("csrf" in res).toBe(false);
    expect("role" in res.student).toBe(false);
  });

  it("empty preferences record is preserved as-is ({} kept, not dropped)", async () => {
    h.getJson = async () => ({ student: { id: "s4" }, preferences: {} });

    const res = await sessionService.get();

    expect(res).toEqual({ student: { id: "s4" }, preferences: {} });
    expect("preferences" in res).toBe(true);
  });
});

describe("sessionService.get — AbortSignal forwarding", () => {
  it("caller signal is forwarded to getJson by reference (not cloned, not dropped)", async () => {
    const ac = new AbortController();
    h.getJson = async () => ({ student: { id: "s5" } });

    const res = await sessionService.get(ac.signal);

    expect(res).toEqual({ student: { id: "s5" } });
    expect(getJson).toHaveBeenCalledWith(SESSION_PATH, ac.signal);
    expect(getJson.mock.calls[0][1]).toBe(ac.signal); // same reference
  });
});

describe("sessionService.get — parse failure (real zod)", () => {
  it("missing `student` → throws ZodError with issue path ['student'], code invalid_type", async () => {
    h.getJson = async () => ({ preferences: { a: 1 } });

    const err = await sessionService.get().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ZodError);
    const issue = (err as ZodError).issues[0];
    expect(issue.path).toEqual(["student"]);
    expect(issue.code).toBe("invalid_type");
  });

  it("wrong-typed nested field (student.id is a number) → ZodError at path ['student','id']", async () => {
    h.getJson = async () => ({ student: { id: 123 } });

    const err = await sessionService.get().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ZodError);
    const issue = (err as ZodError).issues[0];
    expect(issue.path).toEqual(["student", "id"]);
    expect(issue.code).toBe("invalid_type");
  });

  it("non-object payload (null) → ZodError at the root path []", async () => {
    h.getJson = async () => null;

    const err = await sessionService.get().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ZodError);
    expect((err as ZodError).issues[0].path).toEqual([]);
  });
});

describe("sessionService.get — getJson rejection propagates untouched", () => {
  it("getJson rejects → the SAME error is rethrown (not swallowed, not a ZodError)", async () => {
    const boom = new Error("network down");
    h.getJson = async () => {
      throw boom;
    };

    await expect(sessionService.get()).rejects.toBe(boom);
    expect(getJson).toHaveBeenCalledTimes(1);
  });
});
