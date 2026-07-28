import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LicenseInfo, RawSource } from "@/server/ingest/connector";

/**
 * localFilesystemConnector — the §24/M1 local-disk source connector.
 *
 * The ONLY real I/O edge is `readFile` from node:fs/promises; it is faked here and
 * NOTHING else. `basename` (node:path) is pure logic and is exercised for real against
 * hostile-ish paths. Every assertion names the exact produced value (license shape,
 * source field mapping, uri string, the byte buffer identity) — never "returned
 * something". Branches under test:
 *   - id is the fixed "local-filesystem"
 *   - kinds: config.kind provided (left of `?? "manual"`) vs absent (right/default)
 *   - license(): requiresApproval provided true / provided false (left of `?? false`)
 *     vs absent (right/default); licenseUrl present vs undefined; ref arg ignored
 *   - fetch(): source.kind default branch, publisher default branch, authority default
 *     branch, licenseUrl present vs undefined, basename title, `file://` uri
 *   - fetch(): readFile called exactly once with the ref; bytes returned verbatim
 *   - fetch(): readFile rejection propagates (never swallowed — Law 11)
 */

const h = vi.hoisted(() => ({
  readFile: vi.fn<(ref: string) => Promise<Buffer>>(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: (ref: string) => h.readFile(ref),
}));

const { localFilesystemConnector } = await import("@/server/ingest/connectors/localFilesystem");

beforeEach(() => {
  h.readFile.mockReset();
  h.readFile.mockResolvedValue(Buffer.from("default-bytes"));
});

describe("localFilesystemConnector — identity + kinds branch", () => {
  it("id is the fixed 'local-filesystem'", () => {
    const c = localFilesystemConnector({ license: "CC-BY-4.0" });
    expect(c.id).toBe("local-filesystem");
  });

  it("kinds uses config.kind when provided (left of ?? 'manual')", () => {
    const c = localFilesystemConnector({ license: "CC-BY-4.0", kind: "book" });
    expect(c.kinds).toEqual(["book"]);
  });

  it("kinds defaults to ['manual'] when kind absent (right of ?? 'manual')", () => {
    const c = localFilesystemConnector({ license: "CC-BY-4.0" });
    expect(c.kinds).toEqual(["manual"]);
  });
});

describe("localFilesystemConnector — license()", () => {
  it("full config → exact LicenseInfo incl. url + requiresApproval:true (left of ?? false)", async () => {
    const c = localFilesystemConnector({
      license: "NCERT-terms",
      licenseUrl: "https://ncert.example/terms",
      requiresApproval: true,
    });
    const expected: LicenseInfo = {
      permitted: true,
      license: "NCERT-terms",
      url: "https://ncert.example/terms",
      requiresApproval: true,
      reason: "operator asserts licence for local files",
    };
    await expect(c.license("/any/ref")).resolves.toStrictEqual(expected);
  });

  it("minimal config → url:undefined, requiresApproval defaults to false (right of ?? false)", async () => {
    const c = localFilesystemConnector({ license: "proprietary" });
    const expected: LicenseInfo = {
      permitted: true,
      license: "proprietary",
      url: undefined,
      requiresApproval: false,
      reason: "operator asserts licence for local files",
    };
    // toStrictEqual keeps the explicit `url: undefined` key — proves the property exists, not absent.
    await expect(c.license("")).resolves.toStrictEqual(expected);
  });

  it("requiresApproval:false explicitly → false (left operand of ?? kept, not the default)", async () => {
    const c = localFilesystemConnector({ license: "MIT", requiresApproval: false });
    const info = await c.license("ignored");
    expect(info.requiresApproval).toBe(false);
    expect(info.permitted).toBe(true);
  });

  it("license() ignores its ref argument → same object for different refs", async () => {
    const c = localFilesystemConnector({ license: "CC0-1.0" });
    const a = await c.license("/a.txt");
    const b = await c.license("/b.pdf");
    expect(a).toStrictEqual(b);
    expect(a.license).toBe("CC0-1.0");
  });
});

describe("localFilesystemConnector — fetch() field mapping", () => {
  it("full config → every RawSource field from config; title=basename; uri=file://ref; bytes verbatim", async () => {
    const buf = Buffer.from("chapter one contents");
    h.readFile.mockResolvedValueOnce(buf);
    const c = localFilesystemConnector({
      license: "NCERT-terms",
      licenseUrl: "https://ncert.example/terms",
      kind: "book",
      publisher: "NCERT",
      authority: "MoE",
      requiresApproval: true,
    });

    const ref = "/tmp/ncert/science-ch1.pdf";
    const { source, bytes } = await c.fetch(ref);

    const expectedSource: RawSource = {
      kind: "book",
      title: "science-ch1.pdf", // real basename() of the ref
      publisher: "NCERT",
      authority: "MoE",
      uri: "file:///tmp/ncert/science-ch1.pdf",
      license: "NCERT-terms",
      licenseUrl: "https://ncert.example/terms",
    };
    expect(source).toStrictEqual(expectedSource);

    // readFile is the sole I/O edge: called once, with the raw ref, and its buffer is passed through untouched.
    expect(h.readFile).toHaveBeenCalledTimes(1);
    expect(h.readFile).toHaveBeenCalledWith(ref);
    expect(bytes).toBe(buf); // same reference — no copy/transform
    expect(bytes.toString()).toBe("chapter one contents");
  });

  it("minimal config → kind/publisher/authority defaults + licenseUrl:undefined", async () => {
    const buf = Buffer.from("notes");
    h.readFile.mockResolvedValueOnce(buf);
    const c = localFilesystemConnector({ license: "proprietary" });

    const { source, bytes } = await c.fetch("notes.md");

    const expectedSource: RawSource = {
      kind: "manual", // config.kind ?? "manual"
      title: "notes.md",
      publisher: "local", // config.publisher ?? "local"
      authority: "operator", // config.authority ?? "operator"
      uri: "file://notes.md",
      license: "proprietary",
      licenseUrl: undefined, // config.licenseUrl passed through as undefined
    };
    expect(source).toStrictEqual(expectedSource);
    expect(bytes).toBe(buf);
  });

  it("basename strips directories AND a trailing slash (real node:path logic)", async () => {
    const c = localFilesystemConnector({ license: "CC0-1.0" });
    const { source } = await c.fetch("/a/deep/nested/dir/");
    expect(source.title).toBe("dir");
    expect(source.uri).toBe("file:///a/deep/nested/dir/");
  });

  it("readFile rejection propagates out of fetch — never swallowed (Law 11)", async () => {
    const err = new Error("ENOENT: no such file or directory");
    h.readFile.mockRejectedValueOnce(err);
    const c = localFilesystemConnector({ license: "CC-BY-4.0" });

    await expect(c.fetch("/missing/file.txt")).rejects.toThrow("ENOENT: no such file or directory");
    expect(h.readFile).toHaveBeenCalledTimes(1);
    expect(h.readFile).toHaveBeenCalledWith("/missing/file.txt");
  });
});
