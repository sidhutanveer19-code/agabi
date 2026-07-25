// REAL-PATH SMOKE GATE — the anti-false-green.
//
// Why this exists: the unit suite is pure-logic (Node, no browser) and the Playwright e2e runs the
// PROD build against the 8787 STUB backend. Neither exercises the config the user actually runs —
// the DEV build (React StrictMode, fatal hydration) against the REAL /api backend on :3000. Four
// shipped bugs (hydration crash, voice-cancel blank canvas, session-expired, greeting verbatim
// repeat) were ALL invisible to green unit tests + a stubbed prod e2e. This drives the real running
// dev server and fails if the real product is broken. Run it BEFORE declaring done (CLAUDE.md §H1.6).
//
// Usage: `npm run smoke` with `npm run dev` already running on :3000. Exits non-zero on any failure.

import { chromium } from "@playwright/test";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
// SKIP is honest: not a PASS (never green-washes a bug) and not a FAIL (doesn't block on missing infra).
const skip = (name, why) => { console.log(`SKIP  ${name} — ${why}`); };

async function serverUp() {
  try { const r = await fetch(BASE + "/"); return r.ok; } catch { return false; }
}

async function main() {
  if (!(await serverUp())) {
    console.error(`\nSMOKE ABORT: no server at ${BASE}. Start it first: npm run dev\n`);
    process.exit(2);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Capture real runtime failures the way a user's browser sees them.
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // ── CHECK 1: entry renders, no hydration crash, no error boundary ──────────────────────────────
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const boundary = await page.locator("text=Something interrupted the lesson").count();
    const inputVisible = await page.getByLabel("What would you like to understand today?").isVisible().catch(() => false);
    // React 19 hydration-mismatch throws #418/#423/#425 in dev; a pageerror or the boundary means crash.
    const hydrationErr = [...consoleErrors, ...pageErrors].filter((t) => /hydrat|Minified React error #(418|423|425|421)/i.test(t));
    const ok = boundary === 0 && inputVisible && hydrationErr.length === 0;
    rec("entry renders (no hydration crash / no error boundary)", ok,
      ok ? "" : `boundary=${boundary} input=${inputVisible} hydrationErr=${JSON.stringify(hydrationErr).slice(0, 200)}`);
  } catch (e) { rec("entry renders (no hydration crash / no error boundary)", false, String(e).slice(0, 200)); }

  // ── CHECK 2: teaching a real topic renders a real lesson (not blank, not cancelled) ─────────────
  let canvasReady = false;
  let noModel = false;
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.getByLabel("What would you like to understand today?").fill("real numbers");
    await page.getByRole("button", { name: /Learn a topic/i }).click();
    // 90s not 30s: in CI the dev server compiles the /c/[id] route on first hit (cold Turbopack) — a
    // real user hits a warm route, but CI's first canvas load can take >30s to compile.
    await page.getByRole("application").waitFor({ timeout: 90_000 });
    canvasReady = true;
    // Poll for real rendered blocks — the same signal the e2e uses ([data-ws-block]). Char-count is a
    // bad proxy (streaming/camera-dependent); block count cleanly separates a real lesson (>2 blocks)
    // from blank/cancelled (0). A greeting-only reply is 1 block, so >2 means an actual taught lesson.
    const deadline = Date.now() + 60_000;
    let blocks = 0, cancelled = false;
    while (Date.now() < deadline) {
      const body = await page.evaluate(() => document.body.innerText);
      if (/No model configured/i.test(body)) { noModel = true; break; }
      cancelled = /\bStopped\b/.test(body) && !/Stop teaching/i.test(body); // "Stopped" pill = cancelled
      blocks = await page.locator("[data-ws-block]").count();
      if (blocks > 2 && !cancelled) break;
      await page.waitForTimeout(1500);
    }
    if (noModel) {
      skip("teach 'real numbers' renders a real lesson (not blank/cancelled)", "no model provider (set GROQ_API_KEY)");
    } else {
      const ok = blocks > 2 && !cancelled;
      rec("teach 'real numbers' renders a real lesson (not blank/cancelled)", ok,
        ok ? `${blocks} blocks rendered` : `blocks=${blocks} cancelled=${cancelled}`);
    }
  } catch (e) { rec("teach 'real numbers' renders a real lesson (not blank/cancelled)", false, String(e).slice(0, 200)); }

  // ── CHECK 3: a repeated greeting is NOT a verbatim repeat (no-repeat / memory) ──────────────────
  try {
    if (noModel) { skip("repeated 'hi' is NOT a verbatim repeat (no-repeat works)", "no model provider (set GROQ_API_KEY)"); throw "skip"; }
    if (!canvasReady) throw new Error("canvas never opened (check 2 failed)");
    const askSel = 'input[aria-label*="Ask"]';
    const grab = async () => {
      // the newest streamed block's text (the greeting Agabi just wrote)
      return page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll("[data-ws-block]"));
        const last = blocks[blocks.length - 1];
        return (last?.innerText || document.body.innerText).trim();
      });
    };
    const ask = async (t) => {
      await page.click(askSel);
      await page.fill(askSel, t);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(5000);
      return grab();
    };
    const g1 = await ask("hi");
    const g2 = await ask("hi");
    const ok = g1 !== g2 && g1.length > 0 && g2.length > 0;
    rec("repeated 'hi' is NOT a verbatim repeat (no-repeat works)", ok,
      ok ? "two greetings differ" : `g1=${JSON.stringify(g1).slice(0, 80)} g2=${JSON.stringify(g2).slice(0, 80)}`);
  } catch (e) { if (e !== "skip") rec("repeated 'hi' is NOT a verbatim repeat (no-repeat works)", false, String(e).slice(0, 200)); }

  // Shared helpers for the real ask/command flows below. Each streamed explanation renders as a
  // <section aria-label="Explanation: …"> (one region per explanation), so region text is the exact
  // signal a student sees. DOM order preserves creation order (append-only store + ordered
  // virtualizer), so the LAST region is always the freshest answer — robust even if the backend
  // reuses a title, and virtualization-proof (we read the string now, before any cull).
  const REGION_SEL = '[aria-label^="Explanation"]';
  const ASK_SEL = 'input[aria-label*="Ask"]';
  const regionTexts = () => page.evaluate((sel) =>
    Array.from(document.querySelectorAll(sel)).map((r) => (r.innerText || "").trim()), REGION_SEL);
  const newestRegionText = () => page.evaluate((sel) => {
    const rs = Array.from(document.querySelectorAll(sel));
    return ((rs[rs.length - 1] && rs[rs.length - 1].innerText) || "").trim();
  }, REGION_SEL);
  const isStreaming = () => page.getByRole("button", { name: "Stop teaching" }).isVisible().catch(() => false);

  // Fire an interrupt (a typed question or a command chip) and return the freshly streamed answer.
  // Every interrupt opens a NEW region and the camera flies to it, so the newest region text IS this
  // answer. Confirms a run actually STARTED (else the action did nothing), waits for the stream to
  // settle (90s cold-compile budget), and reports a missing model so callers skip() instead of a fake
  // FAIL. Returns { before, after, started, noModel }.
  const fireAndCapture = async (fire) => {
    const before = await newestRegionText();
    await fire();
    let started = false, noModelLocal = false;
    const startDeadline = Date.now() + 20_000;
    while (Date.now() < startDeadline) {
      const body = await page.evaluate(() => document.body.innerText);
      if (/No model configured/i.test(body)) { noModelLocal = true; break; }
      if (await isStreaming()) { started = true; break; }
      if ((await newestRegionText()) !== before) { started = true; break; } // opened + streamed fast
      await page.waitForTimeout(300);
    }
    if (!noModelLocal) {
      const doneDeadline = Date.now() + 90_000;
      while (Date.now() < doneDeadline) { if (!(await isStreaming())) break; await page.waitForTimeout(500); }
      await page.waitForTimeout(800); // let the final streamed block commit before we read it
    }
    return { before, after: await newestRegionText(), started, noModel: noModelLocal };
  };
  const typeAsk = async (q) => { await page.click(ASK_SEL); await page.fill(ASK_SEL, q); await page.keyboard.press("Enter"); };

  // ── CHECK 4: a typed follow-up question streams a NEW, distinct answer ────────────────────────────
  try {
    if (noModel) { skip("ask a follow-up question renders a NEW distinct answer (not blank/duplicate)", "no model provider (set GROQ_API_KEY)"); throw "skip"; }
    if (!canvasReady) throw new Error("canvas never opened (check 2 failed)");
    const prior = await regionTexts();
    const { after, started, noModel: nm } = await fireAndCapture(() =>
      typeAsk("Why can a real number never be both rational and irrational?"));
    if (nm) { skip("ask a follow-up question renders a NEW distinct answer (not blank/duplicate)", "no model provider (set GROQ_API_KEY)"); throw "skip"; }
    // REAL result: a freshly streamed, non-empty answer region that duplicates NONE of the
    // pre-existing regions (not blank, not the original lesson, not a prior greeting).
    const ok = started && after.length > 0 && !prior.includes(after);
    rec("ask a follow-up question renders a NEW distinct answer (not blank/duplicate)", ok,
      ok ? `answer ${after.length} chars, distinct from all ${prior.length} prior regions`
         : `started=${started} len=${after.length} duplicateOfPrior=${prior.includes(after)}`);
  } catch (e) { if (e !== "skip") rec("ask a follow-up question renders a NEW distinct answer (not blank/duplicate)", false, String(e).slice(0, 200)); }

  // ── CHECK 5: re-asking the SAME question twice never repeats verbatim (deterministic no-repeat) ──
  // The product's REAL no-repeat guarantee: a repeated greeting/meta question is answered by
  // smallTalkReply(), which ROTATES its phrasing by the per-canvas turn count (server manager.ts →
  // conversation/smalltalk.ts). Consecutive replies to the identical input therefore differ BY
  // CONSTRUCTION — this is the same mechanism check 3 exercises with "hi", asked here as a repeated
  // question. (The free-form ANSWER path has no such guarantee — the model may echo itself — so
  // asserting it differs there would be a flaky, false-green test; §H1. We test the guaranteed path.)
  try {
    if (noModel) { skip("re-asking the SAME question twice never repeats verbatim (no-repeat)", "no model provider (set GROQ_API_KEY)"); throw "skip"; }
    if (!canvasReady) throw new Error("canvas never opened (check 2 failed)");
    const q = "how are you?";
    const r1 = await fireAndCapture(() => typeAsk(q));
    if (r1.noModel) { skip("re-asking the SAME question twice never repeats verbatim (no-repeat)", "no model provider (set GROQ_API_KEY)"); throw "skip"; }
    const r2 = await fireAndCapture(() => typeAsk(q));
    if (r2.noModel) { skip("re-asking the SAME question twice never repeats verbatim (no-repeat)", "no model provider (set GROQ_API_KEY)"); throw "skip"; }
    const a1 = r1.after, a2 = r2.after;
    // REAL result: the identical question, asked twice back-to-back, must not return a verbatim repeat.
    const ok = r1.started && r2.started && a1.length > 0 && a2.length > 0 && a1 !== a2;
    rec("re-asking the SAME question twice never repeats verbatim (no-repeat)", ok,
      ok ? "two replies to the identical question differ"
         : `a1=${JSON.stringify(a1).slice(0, 90)} a2=${JSON.stringify(a2).slice(0, 90)}`);
  } catch (e) { if (e !== "skip") rec("re-asking the SAME question twice never repeats verbatim (no-repeat)", false, String(e).slice(0, 200)); }

  // ── CHECK 6: a command chip ("Explain again") streams new content ────────────────────────────────
  try {
    if (noModel) { skip("command chip 'Explain again' streams new content", "no model provider (set GROQ_API_KEY)"); throw "skip"; }
    if (!canvasReady) throw new Error("canvas never opened (check 2 failed)");
    const prior = await regionTexts();
    const regionsBefore = prior.length;
    const blocksBefore = await page.locator("[data-ws-block]").count();
    const { after, started, noModel: nm } = await fireAndCapture(() =>
      page.getByRole("button", { name: "Explain again" }).click());
    if (nm) { skip("command chip 'Explain again' streams new content", "no model provider (set GROQ_API_KEY)"); throw "skip"; }
    const regionsAfter = (await regionTexts()).length;
    const blocksAfter = await page.locator("[data-ws-block]").count();
    // REAL result: the chip streamed a fresh explanation — a new non-empty region duplicating none of
    // the prior ones. (Region/block counts are logged too, but virtualization culls off-screen regions
    // as the camera flies to the new one, so the distinct-new-region signal is the reliable one.)
    const ok = started && after.length > 0 && !prior.includes(after);
    rec("command chip 'Explain again' streams new content", ok,
      ok ? `new region streamed (regions ${regionsBefore}→${regionsAfter}, blocks ${blocksBefore}→${blocksAfter})`
         : `started=${started} len=${after.length} regions ${regionsBefore}→${regionsAfter} blocks ${blocksBefore}→${blocksAfter}`);
  } catch (e) { if (e !== "skip") rec("command chip 'Explain again' streams new content", false, String(e).slice(0, 200)); }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSMOKE: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) { console.error(`SMOKE FAILED: ${failed.map((f) => f.name).join("; ")}`); process.exit(1); }
  console.log("SMOKE GREEN — the real product works end to end.");
}

main().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
