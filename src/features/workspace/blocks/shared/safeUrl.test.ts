import { describe, it, expect } from "vitest";
import { safeUrl } from "@/features/workspace/blocks/shared/safeUrl";

describe("safeUrl", () => {
  it("allows https/http for every kind", () => {
    expect(safeUrl("https://example.com/x.mp4", "media")).toBe("https://example.com/x.mp4");
    expect(safeUrl("http://example.com", "frame")).toBe("http://example.com");
    expect(safeUrl("https://cdn.example.com/i.png", "image")).toBe("https://cdn.example.com/i.png");
  });

  it("rejects the dangerous schemes", () => {
    for (const kind of ["frame", "media", "image"] as const) {
      expect(safeUrl("javascript:alert(1)", kind)).toBeNull();
      expect(safeUrl("data:text/html,<script>alert(1)</script>", kind)).toBeNull();
      expect(safeUrl("vbscript:msgbox(1)", kind)).toBeNull();
      expect(safeUrl("file:///etc/passwd", kind)).toBeNull();
    }
  });

  it("rejects protocol-relative and unparseable input", () => {
    expect(safeUrl("//evil.com/x", "media")).toBeNull();
    expect(safeUrl("not a url", "media")).toBeNull();
    expect(safeUrl("", "media")).toBeNull();
    expect(safeUrl(null, "media")).toBeNull();
    expect(safeUrl(undefined, "image")).toBeNull();
  });

  it("frames are stricter: no blob, no data, no relative", () => {
    expect(safeUrl("blob:https://x/abc", "frame")).toBeNull();
    expect(safeUrl("/local/path", "frame")).toBeNull();
    expect(safeUrl("data:image/png;base64,AAAA", "frame")).toBeNull();
  });

  it("media allows blob and same-origin relative but not data", () => {
    expect(safeUrl("blob:https://x/abc", "media")).toBe("blob:https://x/abc");
    expect(safeUrl("/videos/a.mp4", "media")).toBe("/videos/a.mp4");
    expect(safeUrl("./a.mp4", "media")).toBe("./a.mp4");
    expect(safeUrl("data:image/png;base64,AAAA", "media")).toBeNull();
  });

  it("images allow only inline data:image, never data:text/html", () => {
    expect(safeUrl("data:image/png;base64,AAAA", "image")).toBe("data:image/png;base64,AAAA");
    expect(safeUrl("data:image/svg+xml,<svg/>", "image")).toBe("data:image/svg+xml,<svg/>");
    expect(safeUrl("data:text/html,<b>", "image")).toBeNull();
  });

  it("trims surrounding whitespace before judging", () => {
    expect(safeUrl("  https://example.com  ", "frame")).toBe("https://example.com");
  });
});
