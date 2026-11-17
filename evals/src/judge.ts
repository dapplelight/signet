import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ArmId, Pair, RunResult, Shot, Visual } from "./types"

export const RUBRIC = join(import.meta.dir, "../rubric.md")
export const GROUPS = ["layout", "hierarchy", "spacing", "tokens", "states", "responsive"]
export const SEVERITIES = ["critical", "serious", "moderate", "minor"]

export type Check = { id: string; question: string }

/** The yes/no checks in rubric.md: lines like "- `layout.no-overflow`: Is anything wider ...?". The file is the only list. */
export function loadChecks(text = readFileSync(RUBRIC, "utf8")): Check[] {
  return [...text.matchAll(/^- `([a-z]+\.[a-z0-9-]+)`: (.+)$/gm)].map((m) => ({
    id: m[1] as string,
    question: m[2] as string,
  }))
}

/** Every problem with the rubric file, as "rubric: <field>: ..." lines. Empty when it is usable. */
export function validateRubric(file = RUBRIC): string[] {
  if (!existsSync(file)) return [`rubric: file: ${file} does not exist`]
  const checks = loadChecks(readFileSync(file, "utf8"))
  const errors: string[] = []
  for (const g of GROUPS)
    if (!checks.some((c) => c.id.startsWith(`${g}.`)))
      errors.push(`rubric: checks: group "${g}" has no yes/no check`)
  const ids = checks.map((c) => c.id)
  for (const id of ids)
    if (ids.indexOf(id) !== ids.lastIndexOf(id))
      errors.push(`rubric: checks: "${id}" is listed twice`)
  return [...new Set(errors)]
}

/** The judge reads the rubric and the run's own shots, and answers with one JSON object. */
export function judgePrompt(task: string, shots: Shot[], resultsDir: string): string {
  const tiles = shots
    .map((s) =>
      s.path
        ? `- ${s.page} · ${s.mode} · ${s.width}: ${join(resultsDir, s.path)}`
        : `- ${s.page} · ${s.mode} · ${s.width}: No shot: ${s.reason ?? "unknown error"}`,
    )
    .join("\n")
  const checks = loadChecks()
  return `You are a visual reviewer. Check the app built for the task "${task}".

Rubric (follow it exactly):

${readFileSync(RUBRIC, "utf8")}

Read each screenshot with the Read tool. A tile that says "No shot" makes every check it hides a no, and is a finding.

Tiles:
${tiles}

Reply with only one JSON object, no prose and no code fence:
{"checks":{${checks.map((c) => `"${c.id}":true`).join(",")}},"findings":[{"dimension":"layout","severity":"serious","tile":"/ · dark · 390","note":"what is wrong"}]}
Each check is true (yes) or false (no). Each finding cites the tile label it comes from.`
}

/** Reads the judge's reply into a Visual. Throws with the reason when it is not usable. */
export function parseJudge(text: string, ids = loadChecks().map((c) => c.id)): Visual {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) throw new Error("the judge gave no JSON")
  let j: { checks?: Record<string, unknown>; findings?: unknown }
  try {
    j = JSON.parse(m[0])
  } catch {
    throw new Error("the judge gave invalid JSON")
  }
  const checks: Record<string, boolean> = {}
  for (const id of ids) {
    const v = j.checks?.[id]
    if (typeof v !== "boolean") throw new Error(`the judge's answer for ${id} is not true or false`)
    checks[id] = v
  }
  const findings = (Array.isArray(j.findings) ? j.findings : [])
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      dimension: String(f.dimension ?? ""),
      severity: SEVERITIES.includes(String(f.severity)) ? String(f.severity) : "minor",
      tile: String(f.tile ?? ""),
      note: String(f.note ?? ""),
    }))
  return { checks, percent: percentYes(checks), findings }
}

/** Share of checks answered yes, rounded to a whole percent. */
export function percentYes(checks: Record<string, boolean>): number {
  const all = Object.values(checks)
  return all.length ? Math.round((all.filter(Boolean).length / all.length) * 100) : 0
}

/** One `claude -p` call, returning the reply text. Throws when claude fails or prints no JSON. */
async function ask(prompt: string, model: string, maxTurns: number, cwd?: string): Promise<string> {
  const p = Bun.spawn(
    [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      model,
      "--allowedTools",
      "Read",
      "--max-turns",
      String(maxTurns),
    ],
    { stdout: "pipe", stderr: "pipe", cwd },
  )
  const [out] = await Promise.all([new Response(p.stdout).text(), p.exited])
  return ((JSON.parse(out) as { result?: string }).result ?? "") as string
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
    return { visual: parseJudge(await ask(judgePrompt(task, shots, resultsDir), model, 12)) }
  } catch (e) {
    return { visual: null, failure: e instanceof Error ? e.message : String(e) }
  }
}

// --- blind pairwise judge ---

const PAIRS: [ArmId, ArmId][] = [
  ["C", "B"],
  ["B", "A"],
  ["C", "A"],
]

/** The one shot a pairwise judge compares: the first page at 1440, light. Null when it failed to capture. */
export function pairShot(r: RunResult): Shot | null {
  const page = r.shots[0]?.page
  return (
    r.shots.find((s) => s.page === page && s.width === 1440 && s.mode === "light" && s.path) ?? null
  )
}

/** The arm pairs compared, first arm first, for the arms in this eval. */
export const armPairs = (arms: ArmId[]) =>
  PAIRS.filter(([p, q]) => arms.includes(p) && arms.includes(q))

export type PairJob = { task: string; run: number; a: RunResult; b: RunResult }

/** Every same-task, same-run-number pair of arms where both runs have a shot to compare. */
export function pairJobs(rs: RunResult[], arms: ArmId[]): PairJob[] {
  const jobs: PairJob[] = []
  for (const [p, q] of armPairs(arms)) {
    for (const a of rs.filter((r) => r.arm === p && pairShot(r))) {
      const b = rs.find((r) => r.arm === q && r.task === a.task && r.run === a.run && pairShot(r))
      if (b) jobs.push({ task: a.task, run: a.run, a, b })
    }
  }
  return jobs
}

/** The prompt names only X and Y, never an arm or a run. */
export function pairPrompt(task: string, xPath: string, yPath: string): string {
  return `You are a visual reviewer. Two different apps were built for the task "${task}". Read both screenshots with the Read tool and decide which app looks better: layout, hierarchy, spacing, consistent colour and finish.

X: ${xPath}
Y: ${yPath}

Reply with only one JSON object, no prose and no code fence: {"pick":"X"} or {"pick":"Y"} or {"pick":"tie"}. Choose tie only when you cannot tell them apart.`
}

/** Reads the pick. Throws when it is not X, Y or tie. */
export function parsePick(text: string): "X" | "Y" | "tie" {
  const m = /"pick"\s*:\s*"(X|Y|tie)"/.exec(text)
  if (!m) throw new Error("the pairwise judge gave no pick of X, Y or tie")
  return m[1] as "X" | "Y" | "tie"
}

/** Which arm a pick means, given who was shown as X. */
export const pickWinner = (pick: "X" | "Y" | "tie", x: ArmId, y: ArmId): ArmId | "tie" =>
  pick === "tie" ? "tie" : pick === "X" ? x : y

/**
 * Judges one pair blind: the two PNGs are copied to X.png and Y.png in a fresh folder (the file
 * names and paths hold no arm), and which arm is X comes from `rng`. Returns null when the judge fails.
 */
export async function judgePair(
  job: PairJob,
  resultsDir: string,
  model: string,
  rng: () => number = Math.random,
): Promise<{ pair: Pair | null; failure?: string }> {
  const [x, y] = rng() < 0.5 ? [job.a, job.b] : [job.b, job.a]
  const dir = mkdtempSync(join(tmpdir(), "signet-pair-"))
  try {
    const from = (r: RunResult) => join(resultsDir, (pairShot(r) as Shot).path as string)
    copyFileSync(from(x), join(dir, "X.png"))
    copyFileSync(from(y), join(dir, "Y.png"))
    const pick = parsePick(
      await ask(pairPrompt(job.task, join(dir, "X.png"), join(dir, "Y.png")), model, 6, dir),
    )
    return {
      pair: {
        task: job.task,
        run: job.run,
        x: x.arm,
        y: y.arm,
        winner: pickWinner(pick, x.arm, y.arm),
      },
    }
  } catch (e) {
    return { pair: null, failure: e instanceof Error ? e.message : String(e) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
