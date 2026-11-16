/**
 * What `signet check --pages` and the repo's `bun run qa` share: the two
 * viewports, the axe rule tags and the script that runs axe in a page. No
 * imports, so the dev-only runner in scripts/qa can use it as it is.
 */

export const QA_VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]

export const AXE_TAGS = ["wcag2a", "wcag2aa", "best-practice"]

export type AxeViolation = { id: string; help: string; description: string; nodes: unknown[] }

/** A script for `page.evaluate`: loads axe-core from its source, resolves to the violations. */
export const axeScript = (axeSource: string) =>
  `${axeSource}\n;axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(AXE_TAGS)} } }).then((r) => r.violations)`
