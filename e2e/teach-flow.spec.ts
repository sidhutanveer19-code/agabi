import { test, expect, type Page } from "@playwright/test";

// Each test gets a fresh browser context (empty localStorage/sessionStorage); we
// only need to reset the backend's shared in-memory "default" workspace.
test.beforeEach(async ({ request }) => {
  await request.post("http://localhost:8787/__reset").catch(() => {});
});

/** Enter the workspace by typing a topic and clicking "Learn a topic". */
async function enterTopic(page: Page, topic: string) {
  await page.goto("/");
  const input = page.getByLabel("What would you like to understand today?");
  await expect(input).toBeVisible();
  await input.fill(topic);
  await page.getByRole("button", { name: /Learn a topic/i }).click();
  await expect(page.getByRole("application")).toBeVisible();
}

/** Streaming shows a "Stop teaching" control; it disappears when the stream ends. */
async function waitForStreamDone(page: Page, timeout = 60_000) {
  await expect(page.getByRole("button", { name: "Stop teaching" })).toBeHidden({ timeout });
}

test("streams a lesson into a region and restores it on reload", async ({ page }) => {
  await enterTopic(page, "the pythagoras theorem");

  // A streamed explanation region appears with blocks.
  await expect(page.locator('[aria-label^="Explanation"]').first()).toBeVisible();
  await expect.poll(() => page.locator("[data-ws-block]").count(), { timeout: 30_000 }).toBeGreaterThan(2);

  await waitForStreamDone(page);
  expect(await page.locator("[data-ws-block]").count()).toBeGreaterThan(2);

  // Reload → the workspace is RESTORED (not re-taught): exactly one region.
  await page.reload();
  await expect(page.getByRole("application")).toBeVisible();
  await expect(page.locator('[aria-label^="Explanation"]')).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => page.locator("[data-ws-block]").count()).toBeGreaterThan(0);
});

test("serves an enforced CSP and streams with no CSP violations", async ({ page }) => {
  const cspErrors: string[] = [];
  page.on("console", (msg) => {
    if (/content security policy|violat/i.test(msg.text())) cspErrors.push(msg.text());
  });

  const resp = await page.goto("/");
  const csp = resp?.headers()["content-security-policy"];
  expect(csp, "enforced CSP header present in production").toBeTruthy();
  expect(csp).toContain("default-src 'self'");

  await enterTopic(page, "quadratic equations");
  await expect(page.locator('[aria-label^="Explanation"]').first()).toBeVisible();
  await expect.poll(() => page.locator("[data-ws-block]").count()).toBeGreaterThan(2);

  expect(cspErrors, `CSP violations: ${cspErrors.join(" | ")}`).toHaveLength(0);
});
