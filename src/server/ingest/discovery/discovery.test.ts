import { describe, it, expect } from "vitest";
import { parse } from "@/server/ingest/pipeline";
import { buildHierarchy, discover } from "@/server/ingest/discovery/hierarchy";
import { GENERIC_PROFILE, type CurriculumProfile } from "@/server/ingest/discovery/profile";
import type { RawSource } from "@/server/ingest/connector";

const MD = [
  "# Chemical Reactions",
  "",
  "Reactions rearrange atoms.",
  "## Types of Reactions",
  "",
  "There are several types.",
  "### Combination",
  "",
  "Two reactants form one product.",
  "## Balancing Equations",
  "",
  "Mass is conserved.",
].join("\n");

const SOURCE: RawSource = { kind: "book", title: "reactions.md", publisher: "public", authority: "test", uri: "file:///reactions.md", license: "CC0-1.0" };

describe("curriculum discovery (W2) — structure only, deterministic", () => {
  it("nests markdown headings into chapter → section → subsection", () => {
    const h = buildHierarchy(parse(MD, "markdown"), GENERIC_PROFILE);
    expect(h.profile).toBe("generic");
    expect(h.nodes).toHaveLength(1);
    const chapter = h.nodes[0];
    expect(chapter.level).toBe("chapter");
    expect(chapter.title).toBe("Chemical Reactions");
    expect(chapter.children.map((c) => c.title)).toEqual(["Types of Reactions", "Balancing Equations"]);
    expect(chapter.children[0].level).toBe("section");
    expect(chapter.children[0].children[0].title).toBe("Combination");
    expect(chapter.children[0].children[0].level).toBe("subsection");
  });

  it("carries no semantic meaning — subject is null under the generic profile", () => {
    expect(discover(parse(MD, "markdown"), SOURCE).subject).toBeNull();
  });

  it("a profile's subjectRules name the subject deterministically (data, not engine)", () => {
    const chem: CurriculumProfile = {
      id: "test-chem",
      name: "test",
      headingMap: GENERIC_PROFILE.headingMap,
      subjectRules: [{ pattern: /reaction|chemical/i, subject: "Chemistry" }],
    };
    expect(buildHierarchy(parse(MD, "markdown"), chem).subject).toBe("Chemistry");
  });

  it("is deterministic — same doc → identical hierarchy", () => {
    expect(buildHierarchy(parse(MD, "markdown"), GENERIC_PROFILE)).toEqual(buildHierarchy(parse(MD, "markdown"), GENERIC_PROFILE));
  });

  it("empty/flat doc yields an empty hierarchy without throwing", () => {
    expect(buildHierarchy(parse("just prose, no headings.\n", "markdown"), GENERIC_PROFILE).nodes).toEqual([]);
  });
});
