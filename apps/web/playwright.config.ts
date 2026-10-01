import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E (docs/PLAN.md §8, §9; CI: `.github/workflows/e2e.yml`, guide: docs/runbooks/e2e.md).
 *
 * Runs against an app that is already up: `E2E_BASE_URL` (default http://localhost:3000).
 * `E2E_LOCALE=vi|en` (default vi) selects the UI language of the run: browser locale, the
 * `NEXT_LOCALE` cookie of the signed-in session and the language specs assert in. CI runs the
 * whole suite once per locale. With `E2E_SUPABASE_*` set, `global-setup.ts` creates a signed-in
 * internal user and exports `E2E_STORAGE_STATE`; specs that need more (E2E_PAGE_PATH, …) skip.
 * `@playwright/test` is pinned to the browsers installed on CI/dev images.
 *
 * Anti-flake rules: web-first assertions only (no fixed sleeps), generous but bounded timeouts,
 * `retries: 2` on CI with trace/video/screenshot kept for failures, `forbidOnly`, per-test
 * unique data (see `e2e/support`). A test that needs a retry is reported as "flaky" — fix it.
 */
const locale = process.env.E2E_LOCALE === "en" ? "en" : "vi";
const ci = Boolean(process.env.CI);

// Each worker signs in as its own user (created by global-setup): language and time zone live in
// the profile, so specs sharing one user would overwrite each other. This file is loaded again in
// every worker before the specs, which is what makes the override visible to them.
if (process.env.E2E_AUTH_DIR && process.env.TEST_PARALLEL_INDEX !== undefined) {
  process.env.E2E_STORAGE_STATE = path.join(
    process.env.E2E_AUTH_DIR,
    `worker-${process.env.TEST_PARALLEL_INDEX}.json`,
  );
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  workers: ci ? 2 : 4, // ≤ E2E_USER_COUNT in e2e/support/users.ts
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: ci
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["json", { outputFile: "test-results/results.json" }],
      ]
    : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: locale === "en" ? "en-US" : "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: `chromium-${locale}`, use: { ...devices["Desktop Chrome"] } }],
});
