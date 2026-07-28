import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * intent.mut.test.ts — pins the EXACT constants that classifyIntent ships, so that
 * mutating any character of the SYSTEM prompt, its "\n" join separator, or any member
 * of the IntentSchema enum is observed and fails a test.
 *
 * classifyIntent itself never inspects SYSTEM's content — it only forwards it to the
 * provider — so the only way to lock the prompt's bytes is to capture the exact value
 * handed to `generateText`/`ollamaJSON` and assert it verbatim. Likewise the enum
 * literals are never parsed by classifyIntent (it returns RAW advice), so we assert the
 * schema's accepted set directly. Same narrow I/O edges are faked as in intent.test.ts.
 */

const h = vi.hoisted(() => ({
  chain: [] as Array<Record<string, unknown>>,
  gen: (async () => ({ text: "" })) as (a: unknown) => Promise<{ text: string }>,
  oll: (async () => ({ raw: "" })) as (...a: unknown[]) => Promise<{ raw: string }>,
}));

vi.mock("@/server/advisors/providers", () => ({
  providerChain: vi.fn(() => h.chain),
}));
vi.mock("ai", () => ({
  generateText: vi.fn((a: unknown) => h.gen(a)),
}));
vi.mock("@/server/advisors/jsonFill", () => ({
  ollamaJSON: vi.fn((...a: unknown[]) => h.oll(...a)),
}));

const { classifyIntent, IntentSchema } = await import("@/server/advisors/intent");
const { generateText } = await import("ai");
const { ollamaJSON } = await import("@/server/advisors/jsonFill");
const gen = generateText as unknown as ReturnType<typeof vi.fn>;
const oll = ollamaJSON as unknown as ReturnType<typeof vi.fn>;

function toolProvider(over: Record<string, unknown> = {}) {
  return { name: "google:gemini-2.0-flash", model: { __fake: "gemini-model" }, ...over };
}
function ollamaProvider(over: Record<string, unknown> = {}) {
  return {
    name: "ollama:qwen2.5:3b",
    model: { __fake: "ollama-model" },
    ollama: { nativeBase: "http://localhost:11434", modelId: "qwen2.5:3b" },
    ...over,
  };
}

// The EXACT SYSTEM prompt, line-by-line, as the source array joins it with "\n".
// Any StringLiteral mutation ("" / "Stryker was here!") of any array element, or the
// "\n" separator collapsing to "", changes this list and fails the deep-equal below.
const EXPECTED_SYSTEM_LINES = [
  "You classify a student's message to a learning app into ONE label.",
  "Labels: topic (wants to learn a subject) · followup (a QUESTION about what's on screen) ·",
  "continue (wants the next part, bare) · switch_topic (resume a NAMED past lesson) ·",
  "clarification (didn't understand / wants it simpler) · greeting · smalltalk · pause · unclear.",
  "",
  "Rules that matter:",
  "- 'continue' alone = continue. 'continue <subject>' or 'go back to <subject>' = switch_topic (target = the subject).",
  "- Any message ending in '?' or asking what/why/how about the material = followup, NOT continue.",
  "",
  "Examples:",
  '"hi" -> {"intent":"greeting"}',
  '"thanks that helped" -> {"intent":"smalltalk"}',
  '"photosynthesis" -> {"intent":"topic"}',
  '"teach me quadratics" -> {"intent":"topic"}',
  '"continue" -> {"intent":"continue"}',
  '"next" -> {"intent":"continue"}',
  '"continue quadratics" -> {"intent":"switch_topic","target":"quadratics"}',
  '"go back to the water cycle" -> {"intent":"switch_topic","target":"the water cycle"}',
  '"i don\'t get it" -> {"intent":"clarification"}',
  '"what did you explain earlier?" -> {"intent":"followup"}',
  '"why is that true?" -> {"intent":"followup"}',
  "",
  'Reply with ONLY JSON: {"intent":"<label>","target":"<subject, only for switch_topic, else empty>"}. No prose.',
];
const EXPECTED_SYSTEM = EXPECTED_SYSTEM_LINES.join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  h.chain = [];
  h.gen = async () => ({ text: "" });
  h.oll = async () => ({ raw: "" });
});

describe("SYSTEM prompt is shipped verbatim (kills every SYSTEM StringLiteral + the join separator)", () => {
  it("the SDK provider receives the byte-exact SYSTEM string, split cleanly on real newlines", async () => {
    h.chain = [toolProvider()];
    h.gen = async () => ({ text: '{"intent":"greeting"}' });

    await classifyIntent("hi");

    const system = (gen.mock.calls[0][0] as { system: string }).system;
    // Separator must be "\n" (L43 join arg): if it were "" this split yields ONE element.
    expect(system.split("\n")).toEqual(EXPECTED_SYSTEM_LINES);
    expect(system).toBe(EXPECTED_SYSTEM);

    // Line-by-line anchors for the specific surviving mutants (each fails if its line -> "").
    expect(system).toContain("You classify a student's message to a learning app into ONE label."); // L20
    expect(system).toContain("Labels: topic (wants to learn a subject)"); // L21
    expect(system).toContain("continue (wants the next part, bare)"); // L22
    expect(system).toContain("clarification (didn't understand / wants it simpler)"); // L23
    expect(system).toContain("Rules that matter:"); // L25
    expect(system).toContain("- 'continue' alone = continue. 'continue <subject>' or 'go back to <subject>' = switch_topic (target = the subject)."); // L26
    expect(system).toContain("- Any message ending in '?' or asking what/why/how about the material = followup, NOT continue."); // L27
    expect(system).toContain("Examples:"); // L29
    expect(system).toContain('"hi" -> {"intent":"greeting"}'); // L30
    expect(system).toContain('"thanks that helped" -> {"intent":"smalltalk"}'); // L31
    expect(system).toContain('"photosynthesis" -> {"intent":"topic"}'); // L32
    expect(system).toContain('"teach me quadratics" -> {"intent":"topic"}'); // L33
    expect(system).toContain('"continue" -> {"intent":"continue"}'); // L34
    expect(system).toContain('"next" -> {"intent":"continue"}'); // L35
    expect(system).toContain('"continue quadratics" -> {"intent":"switch_topic","target":"quadratics"}'); // L36
    expect(system).toContain('"go back to the water cycle" -> {"intent":"switch_topic","target":"the water cycle"}'); // L37
    expect(system).toContain('"i don\'t get it" -> {"intent":"clarification"}'); // L38
    expect(system).toContain('"what did you explain earlier?" -> {"intent":"followup"}'); // L39
    expect(system).toContain('"why is that true?" -> {"intent":"followup"}'); // L40
    expect(system).toContain('Reply with ONLY JSON: {"intent":"<label>","target":"<subject, only for switch_topic, else empty>"}. No prose.'); // L42

    // The three empty separator lines (L24, L28, L41): each is a blank line joined with "\n",
    // producing a "\n\n" gap. If any "" -> "Stryker was here!" the gap disappears.
    expect(system).toContain("unclear.\n\nRules that matter:"); // L24 blank line
    expect(system).toContain("NOT continue.\n\nExamples:"); // L28 blank line
    expect(system).toContain('{"intent":"followup"}\n\nReply with ONLY JSON'); // L41 blank line
    // And the mutant's literal replacement never leaks into a shipped prompt.
    expect(system).not.toContain("Stryker was here!");
  });

  it("the native ollama provider receives the identical byte-exact SYSTEM string", async () => {
    h.chain = [ollamaProvider()];
    h.oll = async () => ({ raw: '{"intent":"topic"}' });

    await classifyIntent("teach me algebra");

    const system = oll.mock.calls[0][2] as string;
    expect(system.split("\n")).toEqual(EXPECTED_SYSTEM_LINES);
    expect(system).toBe(EXPECTED_SYSTEM);
  });
});

describe("IntentSchema enum locks its exact accepted labels (kills the enum StringLiteral mutants)", () => {
  it("the accepted set is EXACTLY these nine labels, in order", () => {
    expect(IntentSchema.options).toEqual([
      "topic",
      "followup",
      "continue",
      "switch_topic",
      "clarification",
      "greeting",
      "smalltalk",
      "pause",
      "unclear",
    ]);
  });

  it("each survivor-line label is accepted, and its mutated-away form is rejected", () => {
    // L9:24 "continue", L10:32 "smalltalk", L10:45 "pause", L10:54 "unclear".
    for (const label of ["continue", "smalltalk", "pause", "unclear"] as const) {
      expect(IntentSchema.parse(label)).toBe(label);
    }
    // If any of those literals were "" (the mutation), "" would parse and the real label
    // would throw — assert the opposite of both.
    expect(() => IntentSchema.parse("")).toThrow();
    expect(IntentSchema.safeParse("continue").success).toBe(true);
    expect(IntentSchema.safeParse("smalltalk").success).toBe(true);
    expect(IntentSchema.safeParse("pause").success).toBe(true);
    expect(IntentSchema.safeParse("unclear").success).toBe(true);
  });
});

/**
 * Per-mutant kills, DECOUPLED from the EXPECTED_SYSTEM snapshot above.
 *
 * The snapshot test couples all 23 SYSTEM lines + the "\n" separator into one giant
 * `.toBe(EXPECTED_SYSTEM)`; if that constant is ever edited to track a prompt change,
 * every per-line kill would move at once. These assertions instead pin the EXACT bytes
 * the module actually ships, position by position, so each listed StringLiteral / join
 * mutant fails an assertion of its OWN. The system prompt is read back from the value
 * classifyIntent hands to `generateText` (the module never exposes SYSTEM directly).
 */
describe("intent.ts — explicit per-mutant kills (independent of the SYSTEM snapshot)", () => {
  async function shippedSystem(): Promise<string> {
    vi.clearAllMocks();
    h.chain = [toolProvider()];
    h.gen = async () => ({ text: '{"intent":"greeting"}' });
    await classifyIntent("hi");
    return (gen.mock.calls[0][0] as { system: string }).system;
  }

  it("L43:8 — the array is joined with a REAL newline (join(\"\") would collapse to one line)", async () => {
    const system = await shippedSystem();
    expect(system.includes("\n")).toBe(true);
    // 23 source elements → 23 physical lines. join("") yields exactly 1.
    expect(system.split("\n").length).toBe(23);
  });

  it("L20–L23, L25–L27, L29–L40, L42 — every non-blank SYSTEM line ships verbatim at its exact index", async () => {
    const lines = (await shippedSystem()).split("\n");
    expect(lines[0]).toBe("You classify a student's message to a learning app into ONE label."); // L20
    expect(lines[1]).toBe("Labels: topic (wants to learn a subject) · followup (a QUESTION about what's on screen) ·"); // L21
    expect(lines[2]).toBe("continue (wants the next part, bare) · switch_topic (resume a NAMED past lesson) ·"); // L22
    expect(lines[3]).toBe("clarification (didn't understand / wants it simpler) · greeting · smalltalk · pause · unclear."); // L23
    expect(lines[5]).toBe("Rules that matter:"); // L25
    expect(lines[6]).toBe("- 'continue' alone = continue. 'continue <subject>' or 'go back to <subject>' = switch_topic (target = the subject)."); // L26
    expect(lines[7]).toBe("- Any message ending in '?' or asking what/why/how about the material = followup, NOT continue."); // L27
    expect(lines[9]).toBe("Examples:"); // L29
    expect(lines[10]).toBe('"hi" -> {"intent":"greeting"}'); // L30
    expect(lines[11]).toBe('"thanks that helped" -> {"intent":"smalltalk"}'); // L31
    expect(lines[12]).toBe('"photosynthesis" -> {"intent":"topic"}'); // L32
    expect(lines[13]).toBe('"teach me quadratics" -> {"intent":"topic"}'); // L33
    expect(lines[14]).toBe('"continue" -> {"intent":"continue"}'); // L34
    expect(lines[15]).toBe('"next" -> {"intent":"continue"}'); // L35
    expect(lines[16]).toBe('"continue quadratics" -> {"intent":"switch_topic","target":"quadratics"}'); // L36
    expect(lines[17]).toBe('"go back to the water cycle" -> {"intent":"switch_topic","target":"the water cycle"}'); // L37
    expect(lines[18]).toBe('"i don\'t get it" -> {"intent":"clarification"}'); // L38
    expect(lines[19]).toBe('"what did you explain earlier?" -> {"intent":"followup"}'); // L39
    expect(lines[20]).toBe('"why is that true?" -> {"intent":"followup"}'); // L40
    expect(lines[22]).toBe('Reply with ONLY JSON: {"intent":"<label>","target":"<subject, only for switch_topic, else empty>"}. No prose.'); // L42
  });

  it("L24, L28, L41 — the three separator lines are EMPTY ('Stryker was here!' would fill them)", async () => {
    const system = await shippedSystem();
    const lines = system.split("\n");
    expect(lines[4]).toBe(""); // L24 blank
    expect(lines[8]).toBe(""); // L28 blank
    expect(lines[21]).toBe(""); // L41 blank
    expect(system).not.toContain("Stryker was here!");
  });

  it("L9:24, L10:32, L10:45, L10:54 — enum carries these exact labels at these exact positions", () => {
    // A "" mutation of any member changes the value at that index; assert each directly.
    expect(IntentSchema.options[2]).toBe("continue"); // L9:24
    expect(IntentSchema.options[6]).toBe("smalltalk"); // L10:32
    expect(IntentSchema.options[7]).toBe("pause"); // L10:45
    expect(IntentSchema.options[8]).toBe("unclear"); // L10:54
    for (const label of ["continue", "smalltalk", "pause", "unclear"] as const) {
      expect(IntentSchema.safeParse(label).success).toBe(true);
    }
    // The mutated-to-"" form is never an accepted label.
    expect(IntentSchema.safeParse("").success).toBe(false);
  });
});
