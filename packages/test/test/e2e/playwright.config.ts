// Self-test for the Playwright helpers. Baselines go to a temp directory, not
// the repo: they are written by the first pass and checked by the second
// (see the test:e2e script), so the suite runs on any OS.
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  snapshotPathTemplate: join(tmpdir(), "signet-test-e2e", "{arg}{ext}"),
  use: { viewport: { width: 480, height: 320 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  reporter: "line",
})
