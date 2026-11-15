// Self-test for the Playwright helpers. Screenshot baselines are stored in the
// repo for Linux only (CI renders them; fonts differ per OS), so the specs
// that compare screenshots skip elsewhere. Refresh them with
// `bun run test:e2e:update` on Linux, or from the CI job's artifact.
import { defineConfig } from "@playwright/test"

if (process.platform !== "linux")
  console.warn(
    `signet-test e2e: screenshot baselines are Linux-only; the comparison specs are skipped on ${process.platform}.`,
  )

export default defineConfig({
  testDir: ".",
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",
  use: { viewport: { width: 480, height: 320 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  reporter: "line",
})
