import { describe, it, expect } from "vitest";
import { listConnectors, getConnector, pluginSlotConnector } from "@/server/ingest/connectors/registry";
import { acquire, LicenseRefused } from "@/server/ingest/connector";
import { parseFormat, knownFormats, registerParser, hasParser } from "@/server/ingest/parse/registry";

describe("connector framework (W4) — catalog + plugin slots", () => {
  it("catalogs available + plugin-required connectors", () => {
    const ids = listConnectors().map((c) => c.id);
    expect(ids).toContain("local-filesystem");
    expect(ids).toEqual(expect.arrayContaining(["wikipedia", "government-curriculum", "academic-paper", "api", "crawler"]));
    expect(getConnector("local-filesystem")?.status).toBe("available");
    expect(getConnector("wikipedia")?.status).toBe("plugin-required");
  });

  it("a plugin-slot connector refuses at the licence gate — no copyrighted/live fetch", async () => {
    const wiki = pluginSlotConnector("wikipedia", ["web"]);
    await expect(acquire(wiki, "https://en.wikipedia.org/wiki/Anything")).rejects.toBeInstanceOf(LicenseRefused);
  });
});

describe("parser registry (W4) — formats are data, pdf is a slot", () => {
  it("knows markdown/html/json/pdf", () => {
    expect(knownFormats()).toEqual(expect.arrayContaining(["html", "json", "markdown", "pdf"]));
  });

  it("parses a JSON structured source into a Doc via canonical markdown", () => {
    const doc = parseFormat(JSON.stringify({ title: "Cells", blocks: [{ level: 2, heading: "Membrane" }, { text: "A cell has a membrane." }] }), "json");
    const text = doc.map((s) => s.text).join("\n");
    expect(text).toContain("# Cells");
    expect(text).toContain("## Membrane");
    expect(text).toContain("A cell has a membrane.");
  });

  it("pdf is a declared SLOT — throws the E8 deferred-dependency error (no dep added)", () => {
    expect(() => parseFormat("", "pdf")).toThrow(/PDF parsing needs a parser dependency/);
  });

  it("adding a format is a registerParser call, never an engine change", () => {
    registerParser("txt", (raw) => [{ text: raw, sourceRange: [0, raw.length], page: 1 }]);
    expect(hasParser("txt")).toBe(true);
  });
});
