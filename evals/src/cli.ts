import { existsSync, mkdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { ARMS, MCP_BIN, validateArm } from "./arms"
import { RUBRIC } from "./judge"
import { renderReport, runLine } from "./report"
import { runOne } from "./runner"
import { byLevel, loadTasks } from "./tasks"
import type { ArmId, Meta, RunResult } from "./types"

export const USAGE =
  "Usage: bun evals/run.ts --tasks <ids|all> --arms A,B,C --runs N --max-turns N [--model <name>] [--judge-model <name>] [--out <dir>] [--dry-run]"

export type Options = {
  tasks: string
  arms: string[]
  runs: number
  maxTurns: number
  model: string
  judgeModel: string
  out: string | null
  dryRun: boolean
}

/** Reads the flags. Throws "Unknown flag ..." / "... needs ..." with the usage line. */
export function parseArgs(argv: string[]): Options {
  const o: Options = {
    tasks: "all",
    arms: ["A", "B", "C"],
    runs: 1,
    maxTurns: 40,
    model: "sonnet",
    judgeModel: "",
    out: null,
    dryRun: false,
  }
  const fail = (msg: string): never => {
    throw new Error(`${msg}. ${USAGE}`)
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    const v = () => argv[++i] ?? fail(`${a} needs a value`)
    const int = () => {
      const n = Number(v())
      return Number.isInteger(n) && n >= 1 ? n : fail(`${a} needs a whole number of 1 or more`)
    }
    if (a === "--dry-run") o.dryRun = true
    else if (a === "--tasks") o.tasks = v()
    else if (a === "--arms")
      o.arms = v()
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    else if (a === "--runs") o.runs = int()
    else if (a === "--max-turns") o.maxTurns = int()
    else if (a === "--model") o.model = v()
    else if (a === "--judge-model") o.judgeModel = v()
    else if (a === "--out") o.out = v()
    else fail(`Unknown flag ${a}`)
  }
  if (!o.arms.length) fail("--arms needs at least one arm")
  o.judgeModel ||= o.model
  return o
}

/** Every problem with the chosen tasks and arms, as "task <id>: <field>: ..." lines. Empty when all is valid. */
export function validate(o: Options): { errors: string[]; taskIds: string[] } {
  const loaded = loadTasks()
  const errors = [...loaded.errors]
  const want =
    o.tasks === "all"
      ? null
      : o.tasks
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
  for (const id of want ?? [])
    if (!loaded.tasks.some((t) => t.id === id) && !errors.some((e) => e.startsWith(`task ${id}:`)))
      errors.push(
        `task ${id}: id: no such task; use --tasks all or one of ${loaded.tasks.map((t) => t.id).join(", ")}`,
      )
  for (const id of o.arms) {
    const e = validateArm(ARMS[id as ArmId], id)
    if (e) errors.push(e)
  }
  if (o.arms.some((id) => ARMS[id as ArmId]?.mcp) && !existsSync(MCP_BIN))
    errors.push(`mcp: build: ${MCP_BIN} does not exist; run \`bun run build:all\` first`)
  if (!existsSync(RUBRIC)) errors.push(`rubric: file: ${RUBRIC} does not exist`)
  const ids = loaded.tasks
    .sort(byLevel)
    .map((t) => t.id)
    .filter((id) => !want || want.includes(id))
  return { errors, taskIds: ids }
}

export async function main(
  argv: string[],
  log: (s: string) => void = console.log,
): Promise<number> {
  let o: Options
  try {
    o = parseArgs(argv)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 2
  }
  const { errors, taskIds } = validate(o)
  if (errors.length) {
    for (const e of errors) console.error(e)
    return 1
  }
  if (o.dryRun) {
    log(`Dry run: ${taskIds.length} tasks, ${o.arms.length} arms valid. No agent called.`)
    return 0
  }

  const now = new Date().toISOString()
  const date = now.slice(0, 10)
  // The time is in the folder name so a second eval the same day never overwrites the first.
  const stamp = now.slice(0, 19).replace(/:/g, "-")
  const resultsDir = resolve(o.out ?? join(import.meta.dir, "../results", stamp))
  mkdirSync(resultsDir, { recursive: true })
  const tasks = loadTasks()
    .tasks.filter((t) => taskIds.includes(t.id))
    .sort(byLevel)
  const meta: Meta = {
    date,
    model: o.model,
    tasks: taskIds,
    arms: o.arms as ArmId[],
    runs: o.runs,
    maxTurns: o.maxTurns,
  }
  const total = tasks.length * o.arms.length * o.runs
  const results: RunResult[] = []
  const save = async () => {
    await Bun.write(
      join(resultsDir, "results.json"),
      `${JSON.stringify({ ...meta, results }, null, 2)}\n`,
    )
    await Bun.write(join(resultsDir, "report.md"), renderReport(meta, results))
  }
  for (const t of tasks)
    for (const arm of meta.arms)
      for (let run = 1; run <= o.runs; run++) {
        const r = await runOne(t, arm, run, {
          model: o.model,
          maxTurns: o.maxTurns,
          resultsDir,
          judgeModel: o.judgeModel,
        })
        results.push(r)
        log(runLine(results.length, total, r))
        await save() // a crash later keeps everything finished so far
      }
  await save()
  log(`Report: ${relative(process.cwd(), join(resultsDir, "report.md"))}`)
  return 0
}
