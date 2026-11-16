/**
 * signet conformance <baseUrl>: run the Signet wire-contract cases from
 * `@dapplelight/signet-spec/conformance` against a live backend. One line per
 * case, exit 1 when any fails.
 */

import type { ConformanceReport } from "@dapplelight/signet-spec/conformance"
import { SignetCliError } from "./core.js"

const USAGE =
  "Usage: signet conformance <baseUrl> [--auth-prefix /api/auth] [--ingest /api/analytics] [--json]"

export const FLAGS: Record<string, "authPrefix" | "ingestPath" | "sessionsPrefix" | "jsonPath"> = {
  "--auth-prefix": "authPrefix",
  "--ingest": "ingestPath",
  "--sessions": "sessionsPrefix",
  "--json-path": "jsonPath",
}

export function formatReport(report: ConformanceReport, baseUrl: string): string {
  const width = Math.max(0, ...report.results.map((r) => r.id.length))
  const lines = report.results.map(
    (r) => `    ${r.ok ? "pass" : "fail"}  ${r.ok ? r.id : `${r.id.padEnd(width)}  ${r.reason}`}`,
  )
  const summary = report.failed
    ? `${report.passed} passed, ${report.failed} failed against ${baseUrl}.`
    : `All ${report.passed} passed against ${baseUrl}.`
  return `\n${lines.join("\n")}\n\n  ${summary}\n`
}

export async function conformance(args: string[]): Promise<number> {
  const opts: Record<string, string> = {}
  let json = false
  let baseUrl: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    const key = FLAGS[a]
    if (a === "--json") json = true
    else if (key) {
      const v = args[++i]
      if (v === undefined) throw new SignetCliError(`${a} needs a value.`)
      opts[key] = v
    } else if (a.startsWith("-")) throw new SignetCliError(`Unknown option "${a}".`)
    else if (baseUrl === undefined) baseUrl = a
    else throw new SignetCliError(USAGE)
  }
  if (baseUrl === undefined) throw new SignetCliError(USAGE)
  try {
    new URL(baseUrl)
  } catch {
    throw new SignetCliError(`"${baseUrl}" is not a URL. Example: http://localhost:3000`)
  }

  // Lazy, so every other command still runs when this module cannot load.
  const { runConformance } = await import("@dapplelight/signet-spec/conformance")
  const report = await runConformance({
    baseUrl,
    authPrefix: opts.authPrefix ?? "/api/auth",
    ingestPath: opts.ingestPath ?? "/api/analytics",
    sessionsPrefix: opts.sessionsPrefix,
    jsonPath: opts.jsonPath,
  })
  console.log(json ? JSON.stringify(report) : formatReport(report, baseUrl))
  return report.failed ? 1 : 0
}
