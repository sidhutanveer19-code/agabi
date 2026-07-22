import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquire, LicenseRefused, type SourceConnector, type LicenseInfo } from "@/server/ingest/connector";
import { localFilesystemConnector } from "@/server/ingest/connectors/localFilesystem";

// A spy connector recording the order of license/fetch calls, so we can prove ordering.
function spyConnector(info: LicenseInfo): SourceConnector & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    id: "spy",
    kinds: ["web"],
    async license() {
      calls.push("license");
      return info;
    },
    async fetch() {
      calls.push("fetch");
      return {
        source: { kind: "web", title: "t", publisher: "p", authority: "a", license: info.license },
        bytes: Buffer.from("hello"),
      };
    },
  };
}

describe("SourceConnector (§24) — licence gates the fetch", () => {
  it("licence() runs BEFORE fetch()", async () => {
    const c = spyConnector({ permitted: true, license: "CC-BY", requiresApproval: false });
    await acquire(c, "ref");
    expect(c.calls).toEqual(["license", "fetch"]);
  });

  it("a refused licence blocks the fetch entirely", async () => {
    const c = spyConnector({ permitted: false, license: "ALL_RIGHTS_RESERVED", requiresApproval: false, reason: "no reproduction rights" });
    await expect(acquire(c, "ref")).rejects.toBeInstanceOf(LicenseRefused);
    expect(c.calls).toEqual(["license"]); // fetch never happened
  });

  it("an unknown licence needs explicit approval before fetch", async () => {
    const c = spyConnector({ permitted: true, license: "UNKNOWN", requiresApproval: true });
    await expect(acquire(c, "ref")).rejects.toBeInstanceOf(LicenseRefused);
    expect(c.calls).toEqual(["license"]);

    const c2 = spyConnector({ permitted: true, license: "UNKNOWN", requiresApproval: true });
    await acquire(c2, "ref", { approveUnknown: true });
    expect(c2.calls).toEqual(["license", "fetch"]);
  });

  it("local filesystem connector — operator asserts licence and reads the bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agabi-ingest-"));
    const file = join(dir, "chapter.md");
    writeFileSync(file, "# Photosynthesis\n\nPlants convert light.\n");

    const connector = localFilesystemConnector({ kind: "book", license: "CC-BY", publisher: "OpenStax" });
    const info = await connector.license(file);
    expect(info.permitted).toBe(true);
    expect(info.reason).toMatch(/operator asserts/);

    const { source, bytes } = await acquire(connector, file);
    expect(source.title).toBe("chapter.md");
    expect(source.publisher).toBe("OpenStax");
    expect(bytes.toString("utf8")).toContain("Plants convert light");
  });
});
