import { test, expect, type Page } from "@playwright/test";

// The guard for BLUEPRINT amendment A-3: a new canvas teaches its OWN topic and
// does not inherit the previous canvas's conversation (its streamed regions). This
// asserts conversation isolation only — it says nothing about learner *knowledge*,
// which is deliberately shared across canvases and arrives at M8 (Observation store).
//
// Each test gets a fresh browser context; we also clear the backend's in-memory
// workspace store so no stale canvas leaks between runs.
test.beforeEach(async ({ request }) => {
  await request.post("http://localhost:8787/__reset").catch(() => {});
});

/** Type a topic on `/` → mints a fresh canvas and navigates to `/c/{id}`. Returns the id. */
async function openCanvasWithTopic(page: Page, topic: string): Promise<string> {
  await page.goto("/");
  const input = page.getByLabel("What would you like to understand today?");
  await expect(input).toBeVisible();
  await input.fill(topic);
  await page.getByRole("button", { name: /Learn a topic/i }).click();
  await expect(page.getByRole("application")).toBeVisible();
  await page.waitForURL(/\/c\/[^/]+/);
  const m = /\/c\/([^/?]+)/.exec(page.url());
  if (!m) throw new Error(`not on a canvas URL: ${page.url()}`);
  return m[1];
}

/** Streaming shows a "Stop teaching" control; it disappears when the stream ends. */
async function waitForStreamDone(page: Page, timeout = 60_000) {
  await expect(page.getByRole("button", { name: "Stop teaching" })).toBeHidden({ timeout });
}

// A region's DOM label is `Explanation: ${topic}`; match the topic case-insensitively.
const regionFor = (page: Page, topic: string) => page.locator(`[aria-label*="${topic}" i]`);

test("a second canvas teaches its own topic without inheriting the first's conversation", async ({ page }) => {
  // Canvas A — the water cycle.
  const idA = await openCanvasWithTopic(page, "the water cycle");
  await expect(regionFor(page, "water cycle").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.locator("[data-ws-block]").count(), { timeout: 30_000 }).toBeGreaterThan(2);
  await waitForStreamDone(page);

  // Canvas B — a different topic, from a fresh entry. New id, not A's.
  const idB = await openCanvasWithTopic(page, "the french revolution");
  expect(idB, "a new canvas mints a distinct id").not.toBe(idA);
  await expect(regionFor(page, "french revolution").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.locator("[data-ws-block]").count(), { timeout: 30_000 }).toBeGreaterThan(2);
  await waitForStreamDone(page);

  // No conversational bleed: canvas B shows nothing from canvas A.
  await expect(regionFor(page, "water cycle")).toHaveCount(0);

  // Return to canvas A (no goal param → pure restore from persistence, no re-teach).
  await page.goto(`/c/${idA}`);
  await expect(page.getByRole("application")).toBeVisible();
  await expect(regionFor(page, "water cycle").first()).toBeVisible({ timeout: 30_000 });
  // …and A never absorbed B's lesson either. Isolation holds in both directions.
  await expect(regionFor(page, "french revolution")).toHaveCount(0);
});
