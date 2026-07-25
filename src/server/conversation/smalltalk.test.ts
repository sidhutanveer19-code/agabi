import { describe, it, expect } from "vitest";
import { smallTalkReply } from "@/server/conversation/smalltalk";

// Agabi must handle general/meta questions smartly — NOT try to "teach" them as a topic.
describe("smallTalkReply — general questions get a smart reply, never a lesson", () => {
  it("'what's your name' → says it's Agabi", () => {
    expect(smallTalkReply("what is your name?").toLowerCase()).toContain("agabi");
  });
  it("'how are you' → warm + pivots to teaching", () => {
    expect(smallTalkReply("how are you doing").toLowerCase()).toMatch(/learn|teach|topic/);
  });
  it("'what can you do' → states its capability", () => {
    expect(smallTalkReply("what can you do").toLowerCase()).toMatch(/teach|learn|explain/);
  });
  it("'who are you / who made you' → identity", () => {
    expect(smallTalkReply("who are you").toLowerCase()).toContain("agabi");
    expect(smallTalkReply("who made you").toLowerCase()).toContain("agabi");
  });
  it("bare 'hi' → greets and invites a topic", () => {
    expect(smallTalkReply("hi").toLowerCase()).toMatch(/learn|topic|hi|hello/);
  });
  it("never returns empty or a dead-end for any meta input", () => {
    for (const q of ["thanks", "ok", "lol", "good morning", "bye"]) {
      expect(smallTalkReply(q).trim().length).toBeGreaterThan(0);
    }
  });
  it("is pure + deterministic (same input → same output)", () => {
    expect(smallTalkReply("how are you")).toBe(smallTalkReply("how are you"));
  });

  it("NEVER throws and always returns a non-empty reply, even on missing/garbage input (request-path safety)", () => {
    for (const bad of [undefined, null, 123, {}, [], "   "]) {
      expect(() => smallTalkReply(bad as never)).not.toThrow();
      expect(smallTalkReply(bad as never).trim().length).toBeGreaterThan(0);
    }
  });
});
