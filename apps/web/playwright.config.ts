import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E (docs/PLAN.md §9). Minimal setup from T4.1; T7.1b adds the CI workflow, the
 * signed-in fixtures (Supabase) and the vi/en matrix.
 *
 * Runs against an app that is already up: `E2E_BASE_URL` (default http://localhost:3000).
 * Specs that need a page with the editor read `E2E_EDITOR_PATH` and skip without it.
 * `@playwright/test` is pinned to the browsers installed on CI/dev images.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
