// Run: bun test   (unit tests plus --dry-run; never calls an agent or a browser)
import { expect, test } from "bun:test"
import { agentArgs, parseAgent, promptFor } from "../src/agent"
import { ARMS, plainApp, validateArm } from "../src/arms"
import { parseArgs, validate } from "../src/cli"
import { judgePrompt, parseJudge } from "../src/judge"
import { outcome, renderReport, runLine, sample } from "../src/report"
import { sheetHtml } from "../src/shots"
import { loadTasks, validateTask } from "../src/tasks"
import type { Meta, RunResult } from "../src/types"

const run = (...args: string[]) =>
  Bun.spawnSync(["bun", `${import.meta.dir}/../run.ts`, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

const result = (o: Partial<RunResult> = {}): RunResult => ({
  id: "settings-page__B__1",
  task: "settings-page",
  arm: "B",
  run: 1,
  builds: true,
  typechecks: true,
  hidden: true,
  firstTry: true,
  violations: 2,
  turns: 20,
  tokens: 100_000,
  usd: 1,
  wallMs: 120_000,
  shots: [],
  sheet: null,
  visual: null,
  ...o,
})
const meta: Meta = {
  date: "2026-01-02",
  model: "sonnet",
  tasks: ["settings-page"],
  arms: ["A", "B", "C"],
  runs: 1,
  maxTurns: 40,
}

test("the 12 shipped tasks are valid, ordered easy to hard and named like their file", () => {
  const { tasks, errors } = loadTasks()
  expect(errors).toEqual([])
  expect(tasks).toHaveLength(12)
  expect(new Set(tasks.map((t) => t.level)).size).toBeGreaterThan(3)
})

test("a bad task names its id and the field", () => {
  const bad = {
    id: "x",
    level: 9,
    title: "t",
    describe: "d",
    prompt: "p",
    pages: ["a"],
    steps: [{ do: "click", role: "button" }, { do: "nope" }],
  }
  expect(validateTask(bad, "x")).toEqual([
    "task x: level: must be a whole number from 1 to 5",
    'task x: pages: must be a non-empty list of paths starting with "/"',
    "task x: steps[0].name: click needs a string",
    'task x: steps[1].do: unknown step "nope"; use goto, http, click, fill, expectText, expectNoText, expectRole, expectCount, download',
  ])
})

test("arms: A has no MCP and no check, B denies plan_page, C allows it", () => {
  expect(Object.keys(ARMS)).toEqual(["A", "B", "C"])
  for (const [id, a] of Object.entries(ARMS)) expect(validateArm(a, id)).toBeNull()
  expect(validateArm(undefined, "Z")).toContain("arm Z: id: unknown arm")
  expect(ARMS.A).toMatchObject({ mcp: false, check: false })
  expect(ARMS.B.denyTools).toEqual(["mcp__signet__plan_page"])
  expect(ARMS.C.denyTools).toEqual([])
})

test("arm A's app has no Signet in it", () => {
  expect(JSON.stringify(plainApp())).not.toMatch(/signet/i)
})

test("every arm gets the same prompt and model; only the MCP flags differ", () => {
  const task = loadTasks().tasks[0]!
  const args = (id: "A" | "B" | "C") => agentArgs(ARMS[id], task, { model: "sonnet", maxTurns: 7 })
  for (const id of ["A", "B", "C"] as const) {
    expect(args(id)).toContain(promptFor(task))
    expect(args(id)).toContain("7")
  }
  expect(args("A")).not.toContain("--mcp-config")
  expect(args("B")).toContain("--mcp-config")
  expect(args("B")).toContain("mcp__signet__plan_page")
  expect(args("C")).not.toContain("--disallowedTools")
})

test("parseAgent reads turns, tokens and USD from claude's JSON", () => {
  const out = JSON.stringify({
    subtype: "success",
    is_error: false,
    num_turns: 12,
    total_cost_usd: 0.5,
    result: "ok",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 1000,
    },
  })
  expect(parseAgent(out)).toEqual({ ended: true, turns: 12, tokens: 1115, usd: 0.5, text: "ok" })
  expect(parseAgent(JSON.stringify({ subtype: "error_max_turns", num_turns: 40 })).ended).toBe(
    false,
  )
  expect(() => parseAgent("boom")).toThrow("claude printed no JSON")
})

test("parseJudge totals the eight scores and rejects anything else", () => {
  const scores = {
    overflow: 2,
    "clipped-text": 2,
    contrast: 1,
    tokens: 2,
    "dark-mode": 0,
    "tap-targets": 1,
    states: 2,
    spacing: 2,
  }
  const v = parseJudge(
    `Here: ${JSON.stringify({ scores, findings: [{ dimension: "dark-mode", severity: "serious", tile: "/ · dark · 390", note: "white" }] })}`,
  )
  expect(v.total).toBe(12)
  expect(v.findings[0]?.tile).toBe("/ · dark · 390")
  expect(() =>
    parseJudge(JSON.stringify({ scores: { ...scores, spacing: 3 }, findings: [] })),
  ).toThrow("spacing")
  expect(() => parseJudge("no json")).toThrow("no JSON")
})

test("the judge prompt carries the rubric and a failed shot as 'No shot'", () => {
  const p = judgePrompt(
    "t",
    [{ page: "/", width: 390, mode: "dark", path: null, reason: "timeout" }],
    "/r",
  )
  expect(p).toContain("tap-targets")
  expect(p).toContain("/ · dark · 390: No shot: timeout")
  expect(
    sheetHtml("t", [{ page: "/", width: 390, mode: "dark", path: null, reason: "timeout" }], "/r"),
  ).toContain("No shot: timeout")
})

test("the report shows n/a for arm A, signed deltas, and keeps a failed run", () => {
  const rs = [
    result({ id: "s__A__1", arm: "A", violations: null, hidden: false, firstTry: false, usd: 1.5 }),
    result({ id: "s__B__1", arm: "B", usd: 1 }),
    result({ id: "s__C__1", arm: "C", usd: 0.6, violations: 0 }),
    result({
      id: "s__C__2",
      arm: "C",
      run: 2,
      failed: "scaffold exited 1",
      builds: false,
      typechecks: false,
      hidden: false,
      firstTry: false,
      violations: null,
      turns: null,
      tokens: null,
      usd: null,
      wallMs: null,
    }),
  ]
  const md = renderReport(meta, rs)
  expect(md).toContain("# Eval results 2026-01-02")
  expect(md.indexOf("## By arm")).toBeLessThan(md.indexOf("## By task"))
  expect(md.indexOf("## C vs B vs A")).toBeLessThan(md.indexOf("## Spot-check"))
  expect(md).toContain("| A | 1 | 100% | 100% | 0% | 0% | n/a |")
  expect(md).toContain("| C | 2 | 50% |") // the failed run stays in the denominator
  expect(md).toContain("run 2: failed: scaffold exited 1")
  expect(md).toContain("−$0.40") // C vs B USD
  expect(md).toContain("+100 pts") // B vs A hidden pass
  expect(outcome(rs[0] as RunResult)).toBe("fail (hidden test: failed)")
})

test("the report has an empty state", () => {
  expect(renderReport(meta, [])).toContain("No runs finished.")
})

test("10% of runs are sampled, the same ones every time, and at least one", () => {
  const rs = Array.from({ length: 25 }, (_, i) => result({ id: `t${i}__A__1` }))
  expect(sample(rs)).toHaveLength(3)
  expect(sample(rs).map((r) => r.id)).toEqual(sample([...rs].reverse()).map((r) => r.id))
  expect(sample([result()])).toHaveLength(1)
  expect(sample([])).toHaveLength(0)
})

test("a run line reads like the spec", () => {
  expect(
    runLine(
      3,
      12,
      result({ task: "salon-booking", arm: "C", turns: 41, usd: 1.12, wallMs: 362_000 }),
    ),
  ).toBe("[3/12] salon-booking C run 1: pass, 41 turns, $1.12, 6m02s")
})

test("flags: defaults, bad flag and bad number", () => {
  expect(parseArgs([])).toMatchObject({
    tasks: "all",
    arms: ["A", "B", "C"],
    runs: 1,
    dryRun: false,
  })
  expect(parseArgs(["--arms", "a,c", "--runs", "3", "--dry-run"])).toMatchObject({
    arms: ["A", "C"],
    runs: 3,
    dryRun: true,
  })
  expect(() => parseArgs(["--nope"])).toThrow("Unknown flag --nope. Usage: bun evals/run.ts")
  expect(() => parseArgs(["--runs", "0"])).toThrow("--runs needs a whole number")
})

test("validate names an unknown task and an unknown arm", () => {
  const { errors } = validate(parseArgs(["--tasks", "settings-page,nope", "--arms", "A,Z"]))
  expect(errors).toEqual([
    expect.stringContaining("task nope: id: no such task"),
    "arm Z: id: unknown arm; use A, B, C",
  ])
})

test("--dry-run validates 12 tasks and 3 arms and exits 0", () => {
  const r = run("--dry-run")
  expect(r.stdout.toString().trim()).toBe("Dry run: 12 tasks, 3 arms valid. No agent called.")
  expect(r.exitCode).toBe(0)
})

test("--dry-run with an unknown task exits 1 naming the task and field", () => {
  const r = run("--dry-run", "--tasks", "nope")
  expect(r.exitCode).toBe(1)
  expect(r.stderr.toString()).toContain("task nope: id:")
})

test("an unknown flag exits 2", () => {
  expect(run("--nope").exitCode).toBe(2)
})
