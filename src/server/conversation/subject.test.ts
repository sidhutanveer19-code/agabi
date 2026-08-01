import { describe, it, expect } from "vitest";
import { classifySubject } from "@/server/conversation/outline";
import { subjectAccent } from "@/config/tokens";

describe("classifySubject", () => {
  it("classifies the canonical cases", () => {
    expect(classifySubject("quadratic equations")).toBe("Mathematics");
    expect(classifySubject("causes of world war 1")).toBe("History");
    expect(classifySubject("acids, bases and salts")).toBe("Chemistry");
    expect(classifySubject("resources and development")).toBe("Geography");
    expect(classifySubject("asdfgh")).toBe("General");
  });

  it("EVERY output is a real subjectAccent key (a typo → silent violet forever otherwise)", () => {
    const keys = new Set(Object.keys(subjectAccent));
    const probes = [
      "quadratic equations", "newton's laws of motion", "acids and bases", "photosynthesis",
      "the french revolution", "monsoon and climate", "persuasive essay writing", "the constitution",
      "supply and demand", "sorting algorithms", "asdfgh", "", "random gibberish text",
    ];
    for (const p of probes) expect(keys.has(classifySubject(p))).toBe(true);
  });
});
