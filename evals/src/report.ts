import type { ArmId, Meta, RunResult } from "./types"

const MINUS = "−"
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ")
const table = (head: string[], rows: string[][]) =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n")

export const NA = "n/a"
export const sign = (n: number, body: string) =>
  n < 0 ? `${MINUS}${body}` : n > 0 ? `+${body}` : body
export const fmtUsd = (n: number) => `$${Math.abs(n).toFixed(2)}`
export const fmtTime = (ms: number) => {
  const s = Math.round(Math.abs(ms) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
}
const fmtTokens = (n: number) =>
  n >= 1000 ? `${Math.round(Math.abs(n) / 1000)}k` : String(Math.round(Math.abs(n)))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const nums = (rs: RunResult[], f: (r: RunResult) => number | null | undefined) =>
  rs.map(f).filter((v): v is number => typeof v === "number")

/** Pass means built, typechecked and hidden test passed. */
export const passed = (r: RunResult) => !r.failed && r.builds && r.typechecks && r.hidden

/** What went wrong in a run, or "pass". */
export function outcome(r: RunResult): string {
  if (r.failed) return `failed: ${r.failed}`
  if (passed(r)) return "pass"
  const why = !r.builds
    ? "build failed"
    : !r.typechecks
      ? "typecheck failed"
      : `hidden test: ${r.hiddenFailure ?? "failed"}`
  return `fail (${why})`
}

type Stats = {
  n: number
  builds: number
  typechecks: number
  hidden: number
  firstTry: number
  violations: number | null
  visual: number | null
  turns: number | null
  tokens: number | null
  usd: number | null
  wallMs: number | null
}

/** Rates count every run, failed ones included. Averages use the runs that have the number. */
export function stats(rs: RunResult[]): Stats {
  return {
    n: rs.length,
    builds: rs.filter((r) => !r.failed && r.builds).length,
    typechecks: rs.filter((r) => !r.failed && r.typechecks).length,
    hidden: rs.filter((r) => !r.failed && r.hidden).length,
    firstTry: rs.filter((r) => !r.failed && r.firstTry).length,
    violations: mean(nums(rs, (r) => r.violations)),
    visual: mean(nums(rs, (r) => r.visual?.total)),
    turns: mean(nums(rs, (r) => r.turns)),
    tokens: mean(nums(rs, (r) => r.tokens)),
    usd: mean(nums(rs, (r) => r.usd)),
    wallMs: mean(nums(rs, (r) => r.wallMs)),
  }
}

const rate = (k: number, n: number) => (n ? `${Math.round((k / n) * 100)}%` : NA)
const orNa = (v: number | null, f: (v: number) => string) => (v === null ? NA : f(v))
const one = (v: number) => (Math.round(v * 10) / 10).toString()

/** Which runs to show for a run id: 10% of all runs, at least one, picked by a fixed hash so a rerun picks the same. */
export function sample(rs: RunResult[]): RunResult[] {
  const hash = (s: string) =>
    [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
  const k = rs.length ? Math.ceil(rs.length / 10) : 0
  return [...rs].sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id)).slice(0, k)
}

const byArm = (rs: RunResult[], a: ArmId) => rs.filter((r) => r.arm === a)

function armTable(arms: ArmId[], rs: RunResult[]) {
  const rows = arms.map((a) => {
    const s = stats(byArm(rs, a))
    const noCheck = a === "A" // arm A has no signet check; never show 0
    return [
      a,
      String(s.n),
      rate(s.builds, s.n),
      rate(s.typechecks, s.n),
      rate(s.hidden, s.n),
      rate(s.firstTry, s.n),
      noCheck ? NA : orNa(s.violations, one),
      orNa(s.visual, (v) => `${one(v)}/16`),
      orNa(s.turns, one),
      orNa(s.tokens, fmtTokens),
      orNa(s.usd, fmtUsd),
      orNa(s.wallMs, fmtTime),
    ]
  })
  return table(
    [
      "Arm",
      "Runs",
      "Builds",
      "Typechecks",
      "Hidden test pass",
      "First-try pass",
      "Check violations",
      "Visual score",
      "Turns",
      "Tokens",
      "USD",
      "Wall time",
    ],
    rows,
  )
}

function taskTable(tasks: string[], arms: ArmId[], rs: RunResult[]) {
  const rows: string[][] = []
  for (const t of tasks)
    for (const a of arms) {
      const mine = rs.filter((r) => r.task === t && r.arm === a).sort((x, y) => x.run - y.run)
      if (!mine.length) continue
      const s = stats(mine)
      rows.push([
        t,
        a,
        mine.map((r) => `run ${r.run}: ${outcome(r)}`).join("; "),
        rate(s.hidden, s.n),
        orNa(s.visual, (v) => `${one(v)}/16`),
        a === "A" ? NA : orNa(s.violations, one),
        orNa(s.usd, fmtUsd),
      ])
    }
  return table(
    [
      "Task",
      "Arm",
      "Result per run",
      "Hidden test pass",
      "Visual score",
      "Check violations",
      "USD",
    ],
    rows,
  )
}

function deltaTable(arms: ArmId[], rs: RunResult[]) {
  const pairs: [ArmId, ArmId][] = [
    ["B", "A"],
    ["C", "B"],
    ["C", "A"],
  ]
  const has = (a: ArmId) => arms.includes(a) && byArm(rs, a).length > 0
  const metrics: [string, (s: Stats) => number | null, (d: number) => string, boolean][] = [
    [
      "Hidden test pass",
      (s) => (s.n ? (s.hidden / s.n) * 100 : null),
      (d) => `${Math.round(Math.abs(d))} pts`,
      false,
    ],
    [
      "First-try pass",
      (s) => (s.n ? (s.firstTry / s.n) * 100 : null),
      (d) => `${Math.round(Math.abs(d))} pts`,
      false,
    ],
    ["Visual score (of 16)", (s) => s.visual, (d) => one(Math.abs(d)), false],
    ["Check violations", (s) => s.violations, (d) => one(Math.abs(d)), true],
    ["Turns", (s) => s.turns, (d) => one(Math.abs(d)), false],
    ["Tokens", (s) => s.tokens, fmtTokens, false],
    ["USD", (s) => s.usd, fmtUsd, false],
    ["Wall time", (s) => s.wallMs, fmtTime, false],
  ]
  const rows = metrics.map(([name, get, fmt, checkOnly]) => [
    name,
    ...pairs.map(([x, y]) => {
      if (!has(x) || !has(y) || (checkOnly && (x === "A" || y === "A"))) return NA
      const a = get(stats(byArm(rs, x)))
      const b = get(stats(byArm(rs, y)))
      if (a === null || b === null) return NA
      const d = a - b
      return Math.abs(d) < 1e-9 ? fmt(0) : sign(d, fmt(d))
    }),
  ])
  return table(["Metric", "B vs A", "C vs B", "C vs A"], rows)
}

function spotCheck(rs: RunResult[]) {
  const picks = sample(rs)
  if (!picks.length) return "No runs to check."
  return picks
    .map((r) => {
      const home = r.shots.filter((s) => s.page === (r.shots[0]?.page ?? "/"))
      const links = home.map((s) => {
        const label = `${s.width} ${s.mode}`
        return s.path
          ? `[${label}](${s.path})`
          : `${label} (No shot: ${s.reason ?? "unknown error"})`
      })
      const sheet = r.sheet ? ` Sheet: [contact sheet](${r.sheet}).` : ""
      return `- ${r.task} ${r.arm} run ${r.run}: ${links.join(" / ") || "No screenshots."}${sheet}`
    })
    .join("\n")
}

/** report.md for a finished eval. */
export function renderReport(meta: Meta, rs: RunResult[]): string {
  const head = [
    `# Eval results ${meta.date}`,
    "",
    `Model: ${meta.model}. Tasks: ${meta.tasks.join(", ")}. Arms: ${meta.arms.join(", ")}. Runs per task and arm: ${meta.runs}. Max turns: ${meta.maxTurns}.`,
    "",
  ]
  if (!rs.length) return [...head, "No runs finished.", ""].join("\n")
  return [
    ...head,
    "## By arm",
    "",
    armTable(meta.arms, rs),
    "",
    "Rates count every run, failed runs included. Check violations, visual score, turns, tokens, USD and wall time are averages per run. Hidden test pass is the hidden test on the finished app. First-try pass means the app built, typechecked and passed the hidden test after one agent session that ended on its own. Visual score is the judge's total for the rubric in evals/rubric.md; the judge's own cost is not counted.",
    "",
    "## By task",
    "",
    taskTable(meta.tasks, meta.arms, rs),
    "",
    "## C vs B vs A",
    "",
    deltaTable(meta.arms, rs),
    "",
    "A positive number means the first arm of the pair scored higher. For USD, turns, tokens and wall time lower is better.",
    "",
    "## Spot-check",
    "",
    "Look at these runs yourself, about one in ten. Screenshots are 390 and 1440 wide, light and dark. Steps are in scripts/qa/REVIEW.md and evals/rubric.md.",
    "",
    spotCheck(rs),
    "",
  ].join("\n")
}

/** The line printed for one finished run. */
export function runLine(i: number, total: number, r: RunResult): string {
  const what = r.failed ? `failed: ${r.failed}` : passed(r) ? "pass" : "fail"
  const cost =
    r.turns === null ? "" : `, ${r.turns} turns, ${fmtUsd(r.usd ?? 0)}, ${fmtTime(r.wallMs ?? 0)}`
  return `[${i}/${total}] ${r.task} ${r.arm} run ${r.run}: ${what}${cost}`
}
