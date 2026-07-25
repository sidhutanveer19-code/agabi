import { test, expect } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  CLAUDE.md RULES THIS FILE ENFORCES   —  Visual regression = screenshots that catch UI drift
// ──────────────────────────────────────────────────────────────────────────────────────────────────
//   Law 29 Always leave the system better       → flags accidental layout / visual breakage
//   Law 32 Never surprise future engineers      → a changed screen FAILS the check until reviewed
//   Full constitution: /CLAUDE.md
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// VISUAL REGRESSION — catches layout / canvas / UI drift by comparing screenshots to a committed
// baseline. Baselines are platform-specific (Linux, generated in the Playwright container in CI), so
// bootstrap them ONCE via the "update-visual-baselines" workflow (Actions tab → Run workflow), which
// commits the PNGs. After that this spec enforces on every push.
//
// Determinism: the entry screen's example placeholder rotates on a timer. Filling the input hides it
// (showEx = false), so the shot is stable. Animations are disabled for the compare.

test.describe("visual regression", () => {
  test("entry screen layout matches baseline", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("What would you like to understand today?");
    await expect(input).toBeVisible();
    await input.fill("real numbers"); // hides the timer-driven rotating placeholder → deterministic
    await expect(page).toHaveScreenshot("entry.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01, // tolerate sub-pixel AA noise; real layout drift still trips it
      fullPage: false,
    });
  });
});
