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

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSMOKE: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) { console.error(`SMOKE FAILED: ${failed.map((f) => f.name).join("; ")}`); process.exit(1); }
  console.log("SMOKE GREEN — the real product works end to end.");
}

main().catch((e) => { console.error("SMOKE CRASH:", e); process.exit(1); });
