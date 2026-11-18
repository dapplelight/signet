import { defineConfig } from "@playwright/test"

// The smoke test (e2e/smoke.spec.ts) starts its own API with a throwaway
// database and reads the one-time code from its console. Build first, then
// run test:e2e. Browsers, once: `playwright install chromium`.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { headless: true },
})
