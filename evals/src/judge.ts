import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Shot, Visual } from "./types"

export const RUBRIC = join(import.meta.dir, "../rubric.md")
export const DIMENSIONS = [
  "overflow",
  "clipped-text",
  "contrast",
  "tokens",
  "dark-mode",
  "tap-targets",
  "states",
  "spacing",
]
export const SEVERITIES = ["critical", "serious", "moderate", "minor"]

/** The judge reads the rubric and the run's own shots, and answers with one JSON object. */
export function judgePrompt(task: string, shots: Shot[], resultsDir: string): string {
  const tiles = shots
    .map((s) =>
      s.path
        ? `- ${s.page} · ${s.mode} · ${s.width}: ${join(resultsDir, s.path)}`
        : `- ${s.page} · ${s.mode} · ${s.width}: No shot: ${s.reason ?? "unknown error"}`,
    )
    .join("\n")
  return `You are a visual reviewer. Score the app built for the task "${task}".

Rubric (follow it exactly):

${readFileSync(RUBRIC, "utf8")}

Read each screenshot with the Read tool. A tile that says "No shot" is a finding, not a skip.

Tiles:
${tiles}

Reply with only one JSON object, no prose and no code fence:
{"scores":{${DIMENSIONS.map((d) => `"${d}":0`).join(",")}},"findings":[{"dimension":"overflow","severity":"serious","tile":"/ · dark · 390","note":"what is wrong"}]}
Each score is 0, 1 or 2. Each finding cites the tile label it comes from.`
}

/** Reads the judge's reply into a Visual. Throws with the reason when it is not usable. */
export function parseJudge(text: string): Visual {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) throw new Error("the judge gave no JSON")
  let j: { scores?: Record<string, unknown>; findings?: unknown }
  try {
    j = JSON.parse(m[0])
  } catch {
    throw new Error("the judge gave invalid JSON")
  }
  const scores: Record<string, number> = {}
  for (const d of DIMENSIONS) {
    const v = j.scores?.[d]
    if (v !== 0 && v !== 1 && v !== 2)
      throw new Error(`the judge's score for ${d} is not 0, 1 or 2`)
    scores[d] = v
  }
  const findings = (Array.isArray(j.findings) ? j.findings : [])
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      dimension: String(f.dimension ?? ""),
      severity: SEVERITIES.includes(String(f.severity)) ? String(f.severity) : "minor",
      tile: String(f.tile ?? ""),
      note: String(f.note ?? ""),
    }))
  return { total: Object.values(scores).reduce((a, b) => a + b, 0), scores, findings }
}

/** One `claude -p` call that reads the shots. Never throws: a failed judge leaves the visual score empty. */
export async function judge(
  task: string,
  shots: Shot[],
  resultsDir: string,
  model: string,
): Promise<{ visual: Visual | null; failure?: string }> {
  if (!shots.some((s) => s.path)) return { visual: null, failure: "no screenshots to judge" }
  try {
    const p = Bun.spawn(
      [
        "claude",
        "-p",
        judgePrompt(task, shots, resultsDir),
        "--output-format",
        "json",
        "--model",
        model,
        "--allowedTools",
        "Read",
        "--max-turns",
        "12",
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [out] = await Promise.all([new Response(p.stdout).text(), p.exited])
    const reply = JSON.parse(out) as { result?: string }
    return { visual: parseJudge(reply.result ?? "") }
  } catch (e) {
    return { visual: null, failure: e instanceof Error ? e.message : String(e) }
  }
}
