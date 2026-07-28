import { describe, it, expect, beforeEach } from "vitest";
import { useTeachingContext, type Explanation } from "@/features/workspace/ai/context";

/**
 * useTeachingContext — the append-only conversation-context store sent with every
 * /teach request. This module has NO I/O edge (pure zustand state: no db/network/clock),
 * so nothing is mocked; every test asserts the EXACT resulting state object after an
 * action runs, never "it didn't throw".
 *
 * Branches / logic under test:
 *   - create() initial defaults: topic "" · explanations [] · selectedRegionId null
 *   - setTopic → merge-sets topic, leaves explanations + selection untouched
 *   - addExplanation functional updater `[...s.explanations, e]` onto EMPTY and NON-EMPTY
 *     (append order preserved, prior array not mutated — a fresh array each time)
 *   - setSelected with a regionId AND with null (both arms of `string | null`)
 *   - reset() default param `topic = ""` (no arg) AND reset(topic) with an explicit topic
 *     — each clears explanations + selection
 */

const exp = (over: Partial<Explanation> = {}): Explanation => ({
  regionId: "r1",
  title: "Newton's Laws",
  kind: "concept",
  ...over,
});

// Pristine snapshot (data fields + the action functions) captured before any test mutates
// the module-level singleton. Actions never mutate the original arrays, so this stays clean.
const initialState = useTeachingContext.getState();

beforeEach(() => {
  // replace=true restores the exact create() defaults for a fully isolated start per test.
  useTeachingContext.setState(initialState, true);
});

describe("useTeachingContext — initial defaults", () => {
  it("starts empty: topic '' , explanations [], selectedRegionId null", () => {
    const s = useTeachingContext.getState();
    expect(s.topic).toBe("");
    expect(s.explanations).toEqual([]);
    expect(s.selectedRegionId).toBeNull();
  });
});

describe("useTeachingContext — setTopic", () => {
  it("sets the topic to the exact value passed", () => {
    useTeachingContext.getState().setTopic("Photosynthesis");
    expect(useTeachingContext.getState().topic).toBe("Photosynthesis");
  });

  it("merge-sets topic only — explanations and selection are left untouched", () => {
    const e = exp();
    useTeachingContext.getState().setSelected("keep-me");
    useTeachingContext.getState().addExplanation(e);

    useTeachingContext.getState().setTopic("Trigonometry");

    const s = useTeachingContext.getState();
    expect(s.topic).toBe("Trigonometry");
    expect(s.selectedRegionId).toBe("keep-me");
    expect(s.explanations).toEqual([e]);
  });
});

describe("useTeachingContext — addExplanation", () => {
  it("appends onto the empty array → a single-element array equal to the input", () => {
    const e = exp({ regionId: "intro", title: "Intro", kind: "concept" });
    useTeachingContext.getState().addExplanation(e);
    expect(useTeachingContext.getState().explanations).toEqual([e]);
  });

  it("appends in call order and produces a FRESH array (no in-place mutation of the prior)", () => {
    const a = exp({ regionId: "a", title: "A", kind: "concept" });
    const b = exp({ regionId: "b", title: "B", kind: "example" });

    useTeachingContext.getState().addExplanation(a);
    const afterFirst = useTeachingContext.getState().explanations;

    useTeachingContext.getState().addExplanation(b);
    const afterSecond = useTeachingContext.getState().explanations;

    expect(afterSecond).toEqual([a, b]);
    // functional updater built a new array — the earlier reference is a different object...
    expect(afterSecond).not.toBe(afterFirst);
    // ...and the earlier snapshot was not mutated in place.
    expect(afterFirst).toEqual([a]);
  });
});

describe("useTeachingContext — setSelected", () => {
  it("stores the regionId string", () => {
    useTeachingContext.getState().setSelected("region-42");
    expect(useTeachingContext.getState().selectedRegionId).toBe("region-42");
  });

  it("setSelected(null) clears a previously set selection", () => {
    useTeachingContext.getState().setSelected("region-42");
    useTeachingContext.getState().setSelected(null);
    expect(useTeachingContext.getState().selectedRegionId).toBeNull();
  });
});

describe("useTeachingContext — reset", () => {
  it("reset() with no arg defaults topic to '' and clears explanations + selection", () => {
    const st = useTeachingContext.getState();
    st.setTopic("Trigonometry");
    st.addExplanation(exp());
    st.setSelected("r9");

    useTeachingContext.getState().reset();

    const s = useTeachingContext.getState();
    expect(s.topic).toBe("");
    expect(s.explanations).toEqual([]);
    expect(s.selectedRegionId).toBeNull();
  });

  it("reset(topic) sets the new topic and still clears explanations + selection", () => {
    const st = useTeachingContext.getState();
    st.addExplanation(exp({ regionId: "old", title: "Old", kind: "concept" }));
    st.setSelected("r9");

    useTeachingContext.getState().reset("New Chapter");

    const s = useTeachingContext.getState();
    expect(s.topic).toBe("New Chapter");
    expect(s.explanations).toEqual([]);
    expect(s.selectedRegionId).toBeNull();
  });
});
