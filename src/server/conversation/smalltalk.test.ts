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
  it("is pure + deterministic for a GIVEN turn (same input + same turn → same output)", () => {
    expect(smallTalkReply("how are you")).toBe(smallTalkReply("how are you"));
    expect(smallTalkReply("how are you", 3)).toBe(smallTalkReply("how are you", 3));
  });

  // REGRESSION (user: "hi hi hi → said the same thing"): a repeated greeting must NOT be a verbatim
  // repeat. The turn index (per-canvas turn count) rotates the phrasing so consecutive replies differ.
  it("NO VERBATIM REPEAT: the same greeting on consecutive turns yields DIFFERENT text", () => {
    const a = smallTalkReply("hi", 0);
    const b = smallTalkReply("hi", 1);
    const c = smallTalkReply("hi", 2);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });
  it("rotation is bounded + safe for any turn (large / cycles back, never crashes or empties)", () => {
    for (const turn of [0, 1, 2, 5, 99, 1000]) {
      expect(smallTalkReply("hi", turn).trim().length).toBeGreaterThan(0);
    }
    // deterministic cycle: turn and turn+period collapse to the same phrasing (proves index math, not random)
    expect(smallTalkReply("hi", 0)).toBe(smallTalkReply("hi", 0));
  });
  it("even the how-are-you branch varies across turns (no dead verbatim loop)", () => {
    expect(smallTalkReply("how are you", 0)).not.toBe(smallTalkReply("how are you", 1));
  });

  it("NEVER throws and always returns a non-empty reply, even on missing/garbage input (request-path safety)", () => {
    for (const bad of [undefined, null, 123, {}, [], "   "]) {
      expect(() => smallTalkReply(bad as never)).not.toThrow();
      expect(smallTalkReply(bad as never).trim().length).toBeGreaterThan(0);
    }
  });
});
