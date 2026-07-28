import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useVoice } from "@/features/workspace/voice/useVoice";

/**
 * Render-body mutation coverage for the useVoice hook.
 *
 * The unit suite runs under vitest's `node` environment (no jsdom / react-test-renderer), so there is
 * no client commit and `useEffect` never fires. What IS deterministically reachable is the hook's
 * RENDER body via `react-dom/server`: on the server, `useSyncExternalStore` returns its third arg
 * (getServerSnapshot), `useState` yields its initial value, and the hook returns its public API object.
 * These tests pin those exact server-render values so the render-body mutants die.
 *
 * The remaining mutants live inside the two `useEffect` bodies (+ their dependency arrays) and the
 * `useCallback` toggle body — hook internals that only execute on a real client DOM commit, which this
 * node-only, config-frozen suite cannot produce. They are noted as needing a DOM harness, not faked.
 */

interface VoiceApi {
  supported: boolean;
  active: boolean;
  toggle: () => void;
}

/** Server-render the hook once and capture its return value (undefined if the body was emptied). */
function renderUseVoice(streaming: boolean): VoiceApi | undefined {
  const teach = { ask: (_t: string): void => {}, cancel: (): void => {} };
  let captured: VoiceApi | undefined;
  function Probe(): null {
    captured = useVoice(teach, streaming) as VoiceApi | undefined;
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return captured;
}

describe("useVoice — server-render body", () => {
  it("returns exactly { supported, active, toggle } (kills body-emptied and return {} mutants)", () => {
    const api = renderUseVoice(false);
    // L20:103 BlockStatement -> {} would make the hook return undefined.
    expect(api).toBeTruthy();
    // L71:10 ObjectLiteral -> {} would drop every field of the returned API.
    expect(Object.keys(api as object).sort()).toEqual(["active", "supported", "toggle"]);
    expect(typeof api?.toggle).toBe("function");
  });

  it("supported is exactly false from getServerSnapshot (kills L25:83 arrow-body and L25:89 boolean)", () => {
    const api = renderUseVoice(false);
    // L25:83 ArrowFunction -> () => undefined  => supported === undefined.
    // L25:89 BooleanLiteral -> true            => supported === true.
    // The genuine server snapshot is the literal `false`.
    expect(api?.supported).toBe(false);
  });

  it("active initializes to false (kills L26:40 useState(false) -> useState(true))", () => {
    const api = renderUseVoice(false);
    expect(api?.active).toBe(false);
  });

  it("holds regardless of the streaming argument", () => {
    // streaming only feeds the (DOM-only) speak effect; the render body is unaffected either way.
    const streamingOn = renderUseVoice(true);
    expect(streamingOn?.supported).toBe(false);
    expect(streamingOn?.active).toBe(false);
    expect(typeof streamingOn?.toggle).toBe("function");
  });
});
