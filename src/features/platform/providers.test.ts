import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * providers.ts — the single place the app decides where data comes from.
 *
 * The module has exactly one runtime decision: `workspacePersistence` is a
 * ternary on `HAS_SERVER_PERSISTENCE` (config, env-derived) selecting the real
 * `workspaceService` when server persistence is on, else `localWorkspacePersistence`.
 * `teachingProvider` is a flag-independent direct binding to the real `teachingService`.
 *
 * We fake ONLY the narrowest I/O edge — the env-derived `HAS_SERVER_PERSISTENCE`
 * flag (via a config mock) — and wire the REAL service objects. Every assertion
 * names the exact expected object and asserts strict reference identity against the
 * genuine production export (and `.not.toBe` the wrong one), so a mis-wire, a
 * swapped branch, or an inverted condition would turn this red. Because module
 * identity only holds within one module graph, the providers module AND the real
 * services are imported together after each `vi.resetModules()`.
 */

/** Config shape providers.ts + the transitively-loaded apiClient read at runtime. */
function configModule(hasServerPersistence: boolean) {
  return {
    HAS_SERVER_PERSISTENCE: hasServerPersistence,
    API_BASE_URL: "",
    HAS_BACKEND: true,
    REQUEST_TIMEOUT: 20_000,
  };
}

/**
 * Load providers + the REAL services in ONE fresh module graph with the config
 * flag forced to `hasServerPersistence`. Identity of the returned service objects
 * matches whatever providers.ts selected (same graph), so `.toBe` is meaningful.
 */
async function loadWithFlag(hasServerPersistence: boolean) {
  vi.resetModules();
  vi.doMock("@/features/platform/config", () => configModule(hasServerPersistence));

  const [providers, teaching, workspace, local] = await Promise.all([
    import("@/features/platform/providers"),
    import("@/features/platform/services/teachingService"),
    import("@/features/platform/services/workspaceService"),
    import("@/features/workspace/persistence/localStorage"),
  ]);

  return {
    teachingProvider: providers.teachingProvider,
    workspacePersistence: providers.workspacePersistence,
    teachingService: teaching.teachingService,
    workspaceService: workspace.workspaceService,
    localWorkspacePersistence: local.localWorkspacePersistence,
  };
}

/** Load providers against the REAL (unmocked) config — proves the actual wiring. */
async function loadReal() {
  vi.doUnmock("@/features/platform/config");
  vi.resetModules();

  const [providers, config, teaching, workspace, local] = await Promise.all([
    import("@/features/platform/providers"),
    import("@/features/platform/config"),
    import("@/features/platform/services/teachingService"),
    import("@/features/platform/services/workspaceService"),
    import("@/features/workspace/persistence/localStorage"),
  ]);

  return {
    hasServerPersistence: config.HAS_SERVER_PERSISTENCE,
    teachingProvider: providers.teachingProvider,
    workspacePersistence: providers.workspacePersistence,
    teachingService: teaching.teachingService,
    workspaceService: workspace.workspaceService,
    localWorkspacePersistence: local.localWorkspacePersistence,
  };
}

afterEach(() => {
  vi.doUnmock("@/features/platform/config");
  vi.resetModules();
});

describe("workspacePersistence — HAS_SERVER_PERSISTENCE ternary (both branches)", () => {
  it("flag TRUE → binds the real workspaceService, NOT the local cache", async () => {
    const m = await loadWithFlag(true);

    expect(m.workspacePersistence).toBe(m.workspaceService);
    expect(m.workspacePersistence).not.toBe(m.localWorkspacePersistence);

    // Real result is a usable persistence object, not undefined/partial.
    expect(typeof m.workspacePersistence.saveDoc).toBe("function");
    expect(typeof m.workspacePersistence.loadDoc).toBe("function");
    expect(typeof m.workspacePersistence.saveCamera).toBe("function");
    expect(typeof m.workspacePersistence.loadCamera).toBe("function");
  });

  it("flag FALSE → binds the real localWorkspacePersistence, NOT the backend service", async () => {
    const m = await loadWithFlag(false);

    expect(m.workspacePersistence).toBe(m.localWorkspacePersistence);
    expect(m.workspacePersistence).not.toBe(m.workspaceService);

    expect(typeof m.workspacePersistence.saveDoc).toBe("function");
    expect(typeof m.workspacePersistence.loadDoc).toBe("function");
    expect(typeof m.workspacePersistence.saveCamera).toBe("function");
    expect(typeof m.workspacePersistence.loadCamera).toBe("function");
  });

  it("the two branches resolve to DIFFERENT objects (the ternary actually toggles)", async () => {
    const on = await loadWithFlag(true);
    const off = await loadWithFlag(false);

    // Same production identity each side, and the sides are distinct.
    expect(on.workspacePersistence).toBe(on.workspaceService);
    expect(off.workspacePersistence).toBe(off.localWorkspacePersistence);
    // workspaceService is a singleton object; the two graphs pick opposite exports.
    expect(off.workspacePersistence).not.toBe(off.workspaceService);
    expect(on.workspacePersistence).not.toBe(on.localWorkspacePersistence);
  });
});

describe("teachingProvider — flag-independent binding to the real teachingService", () => {
  it("flag TRUE → teachingProvider IS the real teachingService (has a teach() method)", async () => {
    const m = await loadWithFlag(true);

    expect(m.teachingProvider).toBe(m.teachingService);
    expect(m.teachingProvider).not.toBe(m.workspaceService);
    expect(m.teachingProvider).not.toBe(m.localWorkspacePersistence);
    expect(typeof m.teachingProvider.teach).toBe("function");
  });

  it("flag FALSE → teachingProvider is STILL the real teachingService (unaffected by the branch)", async () => {
    const m = await loadWithFlag(false);

    expect(m.teachingProvider).toBe(m.teachingService);
    expect(typeof m.teachingProvider.teach).toBe("function");
  });
});

describe("real config — the genuine default wiring (no mock)", () => {
  it("workspacePersistence matches whatever the REAL HAS_SERVER_PERSISTENCE dictates; teaching always the real service", async () => {
    const m = await loadReal();

    const expected = m.hasServerPersistence ? m.workspaceService : m.localWorkspacePersistence;
    const wrong = m.hasServerPersistence ? m.localWorkspacePersistence : m.workspaceService;

    expect(m.workspacePersistence).toBe(expected);
    expect(m.workspacePersistence).not.toBe(wrong);

    // teachingProvider never depends on the flag.
    expect(m.teachingProvider).toBe(m.teachingService);
    expect(typeof m.teachingProvider.teach).toBe("function");
  });
});
