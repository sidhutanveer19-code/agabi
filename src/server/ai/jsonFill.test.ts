import { describe, it, expect } from "vitest";
import { parseSlotJSON } from "@/server/ai/jsonFill";
import { hasMeaningfulPayload } from "@/server/ai/coerce";
import { ollamaEntries } from "@/server/ai/providers";

describe("parseSlotJSON — permissive, never throws", () => {
  it("parses a fenced ```json block", () => {
    const r = parseSlotJSON('```json\n{ "markdown": "# Topic" }\n```');
    expect(r).toEqual({ markdown: "# Topic" });
  });

  it("extracts an object wrapped in prose before/after", () => {
    const r = parseSlotJSON('Sure, here it is: {"headers":["A","B"],"rows":[["1","2"]]} — hope that helps!');
    expect(r).toEqual({ headers: ["A", "B"], rows: [["1", "2"]] });
  });

  it("is string-aware — a } inside a string value does not truncate", () => {
    const r = parseSlotJSON('{"text":"use the } brace","n":1}');
    expect(r).toEqual({ text: "use the } brace", n: 1 });
  });

  it("returns null on malformed JSON (caller hands raw to coerceSlot)", () => {
    expect(parseSlotJSON("{ not: valid, }")).toBeNull();
    expect(parseSlotJSON("no json here at all")).toBeNull();
    expect(parseSlotJSON("")).toBeNull();
  });

  it("returns null for a top-level array (we want an object)", () => {
    expect(parseSlotJSON("[1,2,3]")).toBeNull();
  });
});

describe("empty-payload check applies to the JSON path too", () => {
  it("{} and {markdown:''} are NOT authored; real content is", () => {
    expect(hasMeaningfulPayload("", {})).toBe(false);
    expect(hasMeaningfulPayload("", { markdown: "" })).toBe(false);
    expect(hasMeaningfulPayload("", { markdown: "# Real" })).toBe(true);
    expect(hasMeaningfulPayload("some prose", {})).toBe(true);
  });
});

describe("capability routing — JSON providers never carry tools", () => {
  it("every ollama entry is supportsTools:false, supportsJSON:true, with a native handle", () => {
    const entries = ollamaEntries();
    expect(entries.map((e) => e.ollama?.modelId)).toEqual(["qwen2.5:3b", "qwen2.5:7b"]);
    for (const e of entries) {
      expect(e.caps.supportsTools).toBe(false); // must never receive a tool definition
      expect(e.caps.supportsJSON).toBe(true);
      expect(e.ollama?.nativeBase).not.toMatch(/\/v1\/?$/); // native base, NOT the /v1 shim
      expect(e.name).toMatch(/^ollama:/);
    }
  });
});
