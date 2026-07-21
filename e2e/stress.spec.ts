import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("http://localhost:8787/__reset").catch(() => {});
});

/**
 * Stress: stream a large lesson (hundreds of blocks into one region) and prove
 * the workspace virtualizes — only viewport-intersecting blocks are in the DOM,
 * and panning keeps the rendered node count bounded (no unbounded growth / crash).
 */
test("virtualizes a large streamed workspace", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/");
  await page.getByLabel("What would you like to understand today?").fill("stress:300");
  await page.getByRole("button", { name: /Learn a topic/i }).click();

  const canvas = page.getByRole("application");
  await expect(canvas).toBeVisible();
  await expect(page.locator('[aria-label^="Explanation"]').first()).toBeVisible();

  // Wait for streaming to finish (the "Stop teaching" control disappears).
  await expect(page.getByRole("button", { name: "Stop teaching" })).toBeHidden({ timeout: 90_000 });

  // 300 blocks were streamed, but virtualization must keep the DOM bounded.
  const rendered = await page.locator("[data-ws-block]").count();
  expect(rendered, "far fewer blocks in DOM than streamed (virtualization culls)").toBeLessThan(150);
  expect(rendered, "some blocks visible").toBeGreaterThan(0);

  // Pan down repeatedly — rendered count must stay bounded (cull keeps up), no crash.
  await canvas.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);

  const afterPan = await page.locator("[data-ws-block]").count();
  expect(afterPan, "rendered count stays bounded after panning").toBeLessThan(150);
  await expect(canvas).toBeVisible(); // still alive
});
