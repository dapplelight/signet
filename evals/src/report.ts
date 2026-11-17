import { armPairs } from "./judge"
import type { ArmId, Meta, Pair, RunResult } from "./types"

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
    visual: mean(nums(rs, (r) => r.visual?.percent)),
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

/** pass@k: at least one of the k runs passed. */
export const passAtK = (rs: RunResult[]) => rs.some(passed)

/** "mean (min–max)" of the numbers, or just the number when there is one, or n/a. */
export function spread(xs: number[], fmt: (v: number) => string): string {
  const m = mean(xs)
  if (m === null) return NA
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return lo === hi ? fmt(m) : `${fmt(m)} (${fmt(lo)}–${fmt(hi)})`
}

/** Tasks (among those the arm ran) where at least one run passed, as a rate. */
function armPassAtK(rs: RunResult[]) {
  const tasks = [...new Set(rs.map((r) => r.task))]
  return rate(tasks.filter((t) => passAtK(rs.filter((r) => r.task === t))).length, tasks.length)
}

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
      armPassAtK(byArm(rs, a)),
      rate(s.firstTry, s.n),
      noCheck ? NA : orNa(s.violations, one),
      orNa(s.visual, (v) => `${Math.round(v)}%`),
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
      "pass@k",
      "First-try pass",
      "Check violations",
      "Visual checks yes",
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
        passAtK(mine) ? "yes" : "no",
        spread(
          nums(mine, (r) => r.visual?.percent),
          (v) => `${Math.round(v)}%`,
        ),
        a === "A"
          ? NA
          : spread(
              nums(mine, (r) => r.violations),
              one,
            ),
        spread(
          nums(mine, (r) => r.usd),
          fmtUsd,
        ),
      ])
    }
  return table(
    [
      "Task",
      "Arm",
      "Result per run",
      "Hidden test pass",
      "pass@k",
      "Visual checks yes, mean (min–max)",
      "Check violations, mean (min–max)",
      "USD, mean (min–max)",
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
    ["Visual checks yes", (s) => s.visual, (d) => `${Math.round(Math.abs(d))} pts`, false],
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

/** Blind pairwise win rates. The first arm of each pair is the one the rate is for; ties count for neither. */
function winTable(arms: ArmId[], pairs: Pair[]) {
  const rows: string[][] = []
  for (const [p, q] of armPairs(arms)) {
    const mine = pairs.filter((x) => [x.x, x.y].includes(p) && [x.x, x.y].includes(q))
    const wins = (a: ArmId) => mine.filter((x) => x.winner === a).length
    rows.push([
      `${p} vs ${q}`,
      String(mine.length),
      String(wins(p)),
      String(wins(q)),
      String(mine.filter((x) => x.winner === "tie").length),
      rate(wins(p), mine.length),
    ])
  }
  return table(
    ["Pair", "Judged", "First arm wins", "Second arm wins", "Ties", "First arm win rate"],
    rows,
  )
}

/** Which Signet MCP tools and CLIs each arm's runs called, and the C runs that called none. */
function toolTable(arms: ArmId[], rs: RunResult[]) {
  const logged = (a: ArmId) => byArm(rs, a).filter((r) => r.signet)
  const names = [...new Set(rs.flatMap((r) => Object.keys(r.signet ?? {})))].sort()
  const rows = arms.map((a) => {
    const ls = logged(a)
    return [
      a,
      String(byArm(rs, a).length),
      String(ls.length),
      String(ls.filter((r) => !Object.keys(r.signet ?? {}).length).length),
      ...names.map((n) => {
        const users = ls.filter((r) => r.signet?.[n])
        const calls = users.reduce((t, r) => t + (r.signet?.[n] ?? 0), 0)
        return `${users.length}/${ls.length} runs, ${calls} calls`
      }),
    ]
  })
  const none = byArm(rs, "C").filter((r) => r.signet && !Object.keys(r.signet).length)
  return [
    table(["Arm", "Runs", "Runs with a tool log", "Runs with no Signet call", ...names], rows),
    "",
    none.length
      ? `Flag: ${none.length} arm C run${none.length === 1 ? "" : "s"} called no Signet tool or CLI, so ${none.length === 1 ? "it was" : "they were"} not really arm C: ${none.map((r) => r.id).join(", ")}.`
      : "No arm C run went without a Signet call.",
  ].join("\n")
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
export function renderReport(meta: Meta, rs: RunResult[], pairs: Pair[] = []): string {
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
    "Rates count every run, failed runs included. Check violations, visual checks, turns, tokens, USD and wall time are averages per run; the By task table adds the lowest and highest run. A run passes when it built, typechecked and passed the hidden test. pass@k means at least one of the k runs of a task passed (k is the runs per task and arm); in the By arm table it is the share of tasks where that holds. First-try pass means the app built, typechecked and passed the hidden test after one agent session that ended on its own. Visual checks yes is the share of the yes/no checks in evals/rubric.md the judge answered yes; the judge's own cost is not counted.",
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
    "## Blind pairwise wins",
    "",
    pairs.length
      ? winTable(meta.arms, pairs)
      : "No pairwise verdicts. They need two arms with a screenshot for the same task and run.",
    "",
    "A judge saw one screenshot from each of two arms for the same task and run, labelled X and Y in random order with no arm named, and picked one or called a tie. The win rate is the first arm's wins over all judged pairs.",
    "",
    "## Signet tool use",
    "",
    toolTable(meta.arms, rs),
    "",
    "Counts come from the tool calls in the agent's JSON output: Signet MCP tools by name, and `cli:check`, `cli:add` and `cli:describe` from Bash commands.",
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
  const flag = r.arm === "C" && r.signet && !Object.keys(r.signet).length ? ", no Signet call" : ""
  return `[${i}/${total}] ${r.task} ${r.arm} run ${r.run}: ${what}${cost}${flag}`
}
