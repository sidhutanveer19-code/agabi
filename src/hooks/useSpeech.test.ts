import { afterEach, describe, expect, it } from "vitest";
import { INITIAL_SPEECH_SUPPORTED, probeSpeechCtor } from "@/hooks/useSpeech";

/**
 * REGRESSION — SSR hydration crash. The mic-support flag was computed in the
 * initial useState from `window` (`getCtor() != null`). On the server there is
 * no `window` → false; on the client's first render `window` exists → true. React
 * 19 treats that server/client divergence as a hydration error and throws to the
 * route error boundary ("Something interrupted the lesson."). The whole app —
 * every canvas — went down the moment voice landed on the entry screen.
 *
 * INVARIANT (the permanent guard): the value used for the FIRST render must be a
 * constant that does not read any browser global, so server and first client
 * render agree. The real capability is probed AFTER mount (in a useEffect).
 */
describe("useSpeech — SSR-safe support flag (no hydration mismatch)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("the first-render value is a hard-coded false — never derived from window", () => {
    // If someone regresses this to `getCtor() != null`, THIS is what changes:
    // a literal false becomes environment-dependent. Server render must be false.
    expect(INITIAL_SPEECH_SUPPORTED).toBe(false);
  });

  it("probe returns null when there is no window (the server / SSR path)", () => {
    // node test env has no `window` — exactly the server's situation.
    expect(typeof window).toBe("undefined");
    expect(probeSpeechCtor()).toBeNull();
  });

  it("probe returns null when window exists but the Speech API is absent (e.g. Firefox)", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(probeSpeechCtor()).toBeNull();
  });

  it("probe returns the ctor when the browser exposes webkitSpeechRecognition", () => {
    class FakeRec {}
    (globalThis as { window?: unknown }).window = { webkitSpeechRecognition: FakeRec };
    expect(probeSpeechCtor()).toBe(FakeRec);
  });

  it("probe prefers the standard SpeechRecognition over the webkit-prefixed one", () => {
    class Std {}
    class Webkit {}
    (globalThis as { window?: unknown }).window = { SpeechRecognition: Std, webkitSpeechRecognition: Webkit };
    expect(probeSpeechCtor()).toBe(Std);
  });
});
