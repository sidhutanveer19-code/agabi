import { describe, it, expect } from "vitest";
import {
  registerConnector,
  getConnector,
  listConnectors,
  pluginSlotConnector,
  type ConnectorEntry,
} from "@/server/ingest/connectors/registry";
import { acquire, LicenseRefused } from "@/server/ingest/connector";

/**
 * Connector registry (W4) — the catalog + the framework-slot connector factory.
 * This module is PURE (only type-imports from `connector`), so there is no I/O to fake:
 * mocking anything here would fake logic, which §H1.7 forbids. Every assertion names the
 * EXACT result — the full seeded catalog verbatim, the sorted order, the exact refusal
 * object, the exact "not implemented" message — never "did not throw / returned something".
 *
 * NOTE on shared state: `CATALOG` is a module-level singleton seeded at import time and
 * mutated by `registerConnector`. The exact-seed assertion therefore runs FIRST (before any
 * mutation); mutation tests use unique ids and assert targeted results, never full equality
 * after a write.
 */

// The catalog exactly as seeded at module load, in the id-sorted order listConnectors() returns.
const SEED: ConnectorEntry[] = [
  { id: "academic-paper", kinds: ["paper"], status: "plugin-required", note: "framework slot — research papers; supply a plugin + assert licence" },
  { id: "api", kinds: ["dataset", "web"], status: "plugin-required", note: "framework slot — a structured API source; supply a plugin" },
  { id: "crawler", kinds: ["web"], status: "plugin-required", note: "framework slot — a web crawler; supply a plugin + robots/licence policy" },
  { id: "government-curriculum", kinds: ["web", "dataset"], status: "plugin-required", note: "framework slot — official curriculum documents; supply a plugin + assert licence" },
  { id: "local-filesystem", kinds: ["book", "manual", "dataset"], status: "available", note: "reads files from disk; the operator asserts the licence (§24)" },
  { id: "wikipedia", kinds: ["web"], status: "plugin-required", note: "framework slot — supply a plugin; no copyrighted/live fetch built" },
];

describe("registry — seeded catalog (must assert before any mutation)", () => {
  it("listConnectors() returns the EXACT 6 seeded entries, id-sorted, with exact fields", () => {
    // Full deep-equality on the whole array: order + every field (kinds, status, note) verbatim.
    expect(listConnectors()).toEqual(SEED);
    expect(listConnectors().map((c) => c.id)).toEqual([
      "academic-paper",
      "api",
      "crawler",
      "government-curriculum",
      "local-filesystem",
      "wikipedia",
    ]);
  });

  it("returns a fresh array each call (spread of Map.values), not a shared mutable reference", () => {
    const a = listConnectors();
    const b = listConnectors();
    expect(a).not.toBe(b); // different array instances
    a.pop(); // mutating the returned array must not corrupt the catalog
    expect(listConnectors()).toHaveLength(6);
  });
});

describe("registry — getConnector", () => {
  it("returns the EXACT entry for a seeded available id", () => {
    expect(getConnector("local-filesystem")).toEqual({
      id: "local-filesystem",
      kinds: ["book", "manual", "dataset"],
      status: "available",
      note: "reads files from disk; the operator asserts the licence (§24)",
    });
  });

  it("returns the EXACT entry for a seeded plugin-required id", () => {
    expect(getConnector("wikipedia")).toEqual({
      id: "wikipedia",
      kinds: ["web"],
      status: "plugin-required",
      note: "framework slot — supply a plugin; no copyrighted/live fetch built",
    });
  });

  it("returns undefined for an unknown id (the not-found path)", () => {
    expect(getConnector("does-not-exist")).toBeUndefined();
  });

  it("returns undefined for the empty-string id (boundary)", () => {
    expect(getConnector("")).toBeUndefined();
  });
});

describe("registry — registerConnector (add + overwrite)", () => {
  it("adds a new entry that getConnector then returns verbatim, and it joins the catalog sorted", () => {
    const entry: ConnectorEntry = {
      id: "test-connector-d",
      kinds: ["manual"],
      status: "available",
      note: "unit-test connector D",
    };
    registerConnector(entry);

    expect(getConnector("test-connector-d")).toEqual(entry);
    const ids = listConnectors().map((c) => c.id);
    expect(ids).toContain("test-connector-d");
    // still globally sorted after the insert
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("overwrites an existing id in place (Map semantics) — second write wins, no duplicate row", () => {
    registerConnector({ id: "test-overwrite-e", kinds: ["web"], status: "plugin-required", note: "first" });
    registerConnector({ id: "test-overwrite-e", kinds: ["dataset"], status: "available", note: "second wins" });

    expect(getConnector("test-overwrite-e")).toEqual({
      id: "test-overwrite-e",
      kinds: ["dataset"],
      status: "available",
      note: "second wins",
    });
    expect(listConnectors().filter((c) => c.id === "test-overwrite-e")).toHaveLength(1);
  });

  it("sorts by id.localeCompare — an id that sorts first goes to index 0, one that sorts last goes to the end", () => {
    registerConnector({ id: "aaa-sort", kinds: ["web"], status: "available", note: "sorts before everything" });
    registerConnector({ id: "zzz-sort", kinds: ["web"], status: "available", note: "sorts after everything" });

    const ids = listConnectors().map((c) => c.id);
    expect(ids[0]).toBe("aaa-sort");
    expect(ids[ids.length - 1]).toBe("zzz-sort");
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});

describe("registry — pluginSlotConnector factory", () => {
  it("passes id and kinds through to the returned SourceConnector verbatim", () => {
    const c = pluginSlotConnector("api", ["dataset", "web"]);
    expect(c.id).toBe("api");
    expect(c.kinds).toEqual(["dataset", "web"]);
    expect(typeof c.license).toBe("function");
    expect(typeof c.fetch).toBe("function");
  });

  it("license() refuses with the EXACT LicenseInfo object (permitted:false, requiresApproval:true, id in reason)", async () => {
    const c = pluginSlotConnector("wikipedia", ["web"]);
    const info = await c.license("ignored-ref");
    expect(info).toEqual({
      permitted: false,
      license: "unknown",
      requiresApproval: true,
      reason: 'connector "wikipedia" is a framework slot — supply a plugin implementation (no copyrighted fetch is built in)',
    });
  });

  it("license() interpolates the given id into the reason (different id → different exact string)", async () => {
    const info = await pluginSlotConnector("crawler", ["web"]).license("ref");
    expect(info.reason).toBe('connector "crawler" is a framework slot — supply a plugin implementation (no copyrighted fetch is built in)');
  });

  it("fetch() rejects with the EXACT 'not implemented' Error message (never returns bytes)", async () => {
    const c = pluginSlotConnector("government-curriculum", ["web", "dataset"]);
    const err = await c.fetch("any-ref").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('connector "government-curriculum" is not implemented — it is a framework slot; register a plugin');
  });
});

describe("registry — real wiring through acquire (§24 licence-before-fetch, falsification)", () => {
  it("acquire() refuses a plugin slot at the licence gate — throws LicenseRefused, fetch NEVER reached", async () => {
    const c = pluginSlotConnector("wikipedia", ["web"]);
    const err = await acquire(c, "https://en.wikipedia.org/wiki/Anything").catch((e: unknown) => e);

    // It must be LicenseRefused (from license()), NOT the plain Error fetch() would throw —
    // proving license refused before a single byte was fetched.
    expect(err).toBeInstanceOf(LicenseRefused);
    const refused = err as LicenseRefused;
    expect(refused.connectorId).toBe("wikipedia");
    expect(refused.ref).toBe("https://en.wikipedia.org/wiki/Anything");
    expect(refused.info.permitted).toBe(false);
    expect(refused.info.requiresApproval).toBe(true);
    expect(refused.message).toBe(
      'connector wikipedia refused https://en.wikipedia.org/wiki/Anything: connector "wikipedia" is a framework slot — supply a plugin implementation (no copyrighted fetch is built in)',
    );
    // and definitively not the fetch() "not implemented" message
    expect(refused.message).not.toContain("is not implemented");
  });

  it("acquire() with approveUnknown STILL refuses — permitted:false is unconditional (not just requiresApproval)", async () => {
    const c = pluginSlotConnector("academic-paper", ["paper"]);
    // Even approving the unknown-licence gate cannot pass a permitted:false slot.
    await expect(acquire(c, "ref", { approveUnknown: true })).rejects.toBeInstanceOf(LicenseRefused);
  });
});
