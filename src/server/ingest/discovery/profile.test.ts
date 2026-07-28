import { describe, it, expect, vi } from "vitest";
import type { CurriculumProfile } from "@/server/ingest/discovery/profile";

/**
 * Curriculum profile registry (W2) — the "curriculum is DATA, not code" seam.
 *
 * This module is a pure in-memory open registry: register / get / list over a module-level
 * Map, plus the GENERIC_PROFILE constant that is auto-registered as a module-load side effect.
 * There is NO I/O boundary here (no db/network/clock), so nothing is mocked — every assertion
 * exercises the module's OWN real logic and names the exact expected value.
 *
 * Branches / paths covered:
 *   - module-load side effect: GENERIC_PROFILE is registered as the exported object (by reference)
 *   - GENERIC_PROFILE exact shape, incl. the 5→topic / 6→topic collapse and the OMITTED subjectRules
 *   - getProfile: hit (returns the exact registered object) vs miss (unknown id, empty-string id → undefined)
 *   - registerProfile: adds, overwrites same-id in place (Map.set), carries subjectRules verbatim
 *   - listProfiles: fresh array per call (spread), insertion order, immune to caller mutation
 *
 * Each test re-imports a FRESH module (vi.resetModules) so the internal Map starts with ONLY the
 * auto-registered GENERIC_PROFILE — counts, order, and reference identity are deterministic and no
 * registration leaks between tests.
 */

type ProfileModule = typeof import("@/server/ingest/discovery/profile");

async function loadFresh(): Promise<ProfileModule> {
  vi.resetModules();
  return import("@/server/ingest/discovery/profile");
}

function makeProfile(over: Partial<CurriculumProfile> = {}): CurriculumProfile {
  return {
    id: "cbse",
    name: "CBSE Class 10",
    headingMap: { 1: "chapter", 2: "section" },
    ...over,
  };
}

describe("GENERIC_PROFILE — the always-available default constant", () => {
  it("has the exact shape: generic id/name, full 1→6 headingMap, NO subjectRules key", async () => {
    const { GENERIC_PROFILE } = await loadFresh();

    expect(GENERIC_PROFILE.id).toBe("generic");
    expect(GENERIC_PROFILE.name).toBe("Generic document structure");
    expect(GENERIC_PROFILE.headingMap).toEqual({
      1: "chapter",
      2: "section",
      3: "subsection",
      4: "topic",
      5: "topic",
      6: "topic",
    });
    // Levels 5 and 6 deliberately collapse onto "topic" (only 5 structural levels exist).
    expect(GENERIC_PROFILE.headingMap[5]).toBe("topic");
    expect(GENERIC_PROFILE.headingMap[6]).toBe("topic");
    // The optional subjectRules is OMITTED (not just undefined) → "no subject opinion".
    expect("subjectRules" in GENERIC_PROFILE).toBe(false);
    expect(GENERIC_PROFILE.subjectRules).toBeUndefined();
  });
});

describe("module-load side effect — GENERIC_PROFILE auto-registers", () => {
  it("getProfile('generic') returns the SAME exported object (by reference), not a copy", async () => {
    const { getProfile, GENERIC_PROFILE } = await loadFresh();
    expect(getProfile("generic")).toBe(GENERIC_PROFILE);
  });

  it("a freshly loaded registry contains EXACTLY [GENERIC_PROFILE] and nothing else", async () => {
    const { listProfiles, GENERIC_PROFILE } = await loadFresh();
    const all = listProfiles();
    expect(all).toHaveLength(1);
    expect(all[0]).toBe(GENERIC_PROFILE);
    expect(all.map((p) => p.id)).toEqual(["generic"]);
  });
});

describe("getProfile — hit vs miss", () => {
  it("returns undefined for an id that was never registered", async () => {
    const { getProfile } = await loadFresh();
    expect(getProfile("jee")).toBeUndefined();
  });

  it("returns undefined for the empty-string id (edge)", async () => {
    const { getProfile } = await loadFresh();
    expect(getProfile("")).toBeUndefined();
  });

  it("returns the exact registered object after registerProfile", async () => {
    const { registerProfile, getProfile } = await loadFresh();
    const p = makeProfile({ id: "cbse-x" });
    registerProfile(p);
    expect(getProfile("cbse-x")).toBe(p);
  });

  it("get is exact-key: registering 'cbse' does NOT satisfy a lookup for a different id", async () => {
    const { registerProfile, getProfile } = await loadFresh();
    registerProfile(makeProfile({ id: "cbse" }));
    expect(getProfile("neet")).toBeUndefined();
  });
});

describe("registerProfile — add, overwrite, and carry subjectRules verbatim", () => {
  it("adds a new profile: listProfiles grows by exactly one and keeps insertion order", async () => {
    const { registerProfile, listProfiles } = await loadFresh();
    const p = makeProfile({ id: "ib" });
    registerProfile(p);

    const all = listProfiles();
    expect(all).toHaveLength(2); // generic + ib
    expect(all.map((x) => x.id)).toEqual(["generic", "ib"]);
    expect(all[1]).toBe(p);
  });

  it("re-registering the SAME id overwrites in place — no duplicate, new object wins", async () => {
    const { registerProfile, getProfile, listProfiles } = await loadFresh();
    const first = makeProfile({ id: "cbse", name: "First" });
    const second = makeProfile({ id: "cbse", name: "Second" });

    registerProfile(first);
    registerProfile(second);

    expect(getProfile("cbse")).toBe(second);
    expect(getProfile("cbse")).not.toBe(first);
    expect(getProfile("cbse")?.name).toBe("Second");
    // Overwrite, not append: still generic + one cbse.
    expect(listProfiles()).toHaveLength(2);
    expect(listProfiles().filter((p) => p.id === "cbse")).toHaveLength(1);
  });

  it("carries subjectRules (RegExp + subject, ordered) faithfully — the data the engine reads back", async () => {
    const { registerProfile, getProfile } = await loadFresh();
    const rules: NonNullable<CurriculumProfile["subjectRules"]> = [
      { pattern: /physics/i, subject: "Physics" },
      { pattern: /chem/i, subject: "Chemistry" },
    ];
    const p = makeProfile({ id: "science", subjectRules: rules });
    registerProfile(p);

    const got = getProfile("science");
    expect(got?.subjectRules).toBe(rules); // same array reference, not a clone
    expect(got?.subjectRules).toEqual([
      { pattern: /physics/i, subject: "Physics" },
      { pattern: /chem/i, subject: "Chemistry" },
    ]);
    // first-match-wins ordering is preserved, and the stored RegExp still matches.
    expect(got?.subjectRules?.[0].subject).toBe("Physics");
    expect(got?.subjectRules?.[0].pattern.test("PHYSICS 101")).toBe(true);
    expect(got?.subjectRules?.[1].pattern.test("Organic Chemistry")).toBe(true);
  });

  it("registering a new profile does NOT mutate the existing GENERIC_PROFILE entry", async () => {
    const { registerProfile, getProfile, GENERIC_PROFILE } = await loadFresh();
    registerProfile(makeProfile({ id: "cbse" }));
    expect(getProfile("generic")).toBe(GENERIC_PROFILE);
    expect(GENERIC_PROFILE.name).toBe("Generic document structure");
  });
});

describe("listProfiles — fresh copy, ordered, mutation-proof", () => {
  it("returns a NEW array each call (spread), never the internal collection", async () => {
    const { listProfiles } = await loadFresh();
    const a = listProfiles();
    const b = listProfiles();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("mutating the returned array does NOT corrupt the registry", async () => {
    const { listProfiles, getProfile } = await loadFresh();
    const snapshot = listProfiles();
    snapshot.push(makeProfile({ id: "injected" }));

    // The internal registry is untouched: still only generic, and the bogus id was never stored.
    expect(listProfiles()).toHaveLength(1);
    expect(getProfile("injected")).toBeUndefined();
  });

  it("reflects insertion order across multiple registrations", async () => {
    const { registerProfile, listProfiles } = await loadFresh();
    registerProfile(makeProfile({ id: "b" }));
    registerProfile(makeProfile({ id: "a" }));
    registerProfile(makeProfile({ id: "c" }));
    expect(listProfiles().map((p) => p.id)).toEqual(["generic", "b", "a", "c"]);
  });
});
