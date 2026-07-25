import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e — runs the REAL student production build (enforced CSP) against
 * the dev-backend contract stub, across three browser engines (Chromium, Firefox,
 * WebKit) for genuine cross-browser coverage. Serial (workers:1) because tests
 * share the backend's single "default" workspace.
 */
const PORT = 3100;
const API = "http://localhost:8787";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI, // a committed .only() fails CI — no accidental "only this one flow ran"
  retries: process.env.CI ? 2 : 0, // CI retries a flaky flow twice before failing; local = no masking
  reporter: [["list"], ["html", { open: "never" }]], // HTML report artifact for failures
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure", // full timeline/DOM/network of any failure — open with `npx playwright show-trace`
    screenshot: "only-on-failure", // pixel evidence of what broke
    video: "retain-on-failure", // watch the failing flow end to end
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "npm run dev:backend",
      port: 8787,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `NEXT_PUBLIC_API_BASE_URL=${API} npm run build && NEXT_PUBLIC_API_BASE_URL=${API} npx next start -p ${PORT}`,
      port: PORT,
      reuseExistingServer: true,
      timeout: 300_000,
    },
  ],
});
