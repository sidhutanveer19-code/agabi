import { describe, it, expect } from "vitest";
import { storageId, bareId } from "@/server/conversation/ids";

describe("workspace id round-trip", () => {
  // The nasty case ("weird:user:id") is why bareId slices by userId.length,
  // not split(":") — a colon in the userId must not corrupt the bare canvas id.
  const users = ["user_2abc", "dev-user", "dev_x9Zk-abc", "weird:user:id"];
  const canvases = ["default", "c-123", "abc:def", "550e8400-e29b-41d4-a716-446655440000"];

  it("bareId(u, storageId(u, c)) === c for every user × canvas", () => {
    for (const u of users) {
      for (const c of canvases) {
        expect(bareId(u, storageId(u, c))).toBe(c);
      }
    }
  });

  it("storageId composes as `${userId}:${canvasId}`", () => {
    expect(storageId("dev_abc", "default")).toBe("dev_abc:default");
  });
});
