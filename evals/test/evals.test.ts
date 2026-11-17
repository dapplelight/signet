// Run: bun test   (unit tests plus --dry-run; never calls an agent or a browser)
import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { agentArgs, parseAgent, promptFor } from "../src/agent"
import { ARMS, MCP_BIN, plainApp, validateArm } from "../src/arms"
import { parseArgs, validate } from "../src/cli"
import {
  armPairs,
  judgePrompt,
  loadChecks,
  pairJobs,
  pairPrompt,
  parseJudge,
  parsePick,
  pickWinner,
  validateRubric,
} from "../src/judge"
import { outcome, passAtK, renderReport, runLine, sample, spread } from "../src/report"
import { sheetHtml } from "../src/shots"
import { loadTasks, validateTask } from "../src/tasks"
import type { Meta, Pair, RunResult } from "../src/types"

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
  signet: null,
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

test("the 15 shipped tasks are valid, ordered easy to hard and named like their file", () => {
  const { tasks, errors } = loadTasks()
  expect(errors).toEqual([])
  expect(tasks).toHaveLength(15)
  expect(new Set(tasks.map((t) => t.level)).size).toBeGreaterThan(3)
})

test("the three real-failure tasks have hidden checks that can fail", () => {
  const { tasks } = loadTasks()
  const get = (id: string) => tasks.find((t) => t.id === id)?.steps ?? []
  // hex colours: the pattern flags hard-coded colours and lets token use through
  const rx = new RegExp(
    get("hardcoded-colours").find((s) => s.do === "sourceForbids")?.pattern as string,
  )
  for (const bad of [
    'color: "#3b82f6"',
    "bg-[#fff]",
    "style={{ background: 'rgb(0, 128, 0)' }}",
    "`#abc`",
  ])
    expect(rx.test(bad)).toBe(true)
  for (const ok of ["Order #1234", "bg-primary", "rgb(var(--ok))", "text-success"])
    expect(rx.test(ok)).toBe(false)
  // raw fetch and form: they mock the server, with an error envelope and a non-JSON failure
  const mocks = [...get("raw-fetch-errors"), ...get("form-states")].filter(
    (s) => s.do === "mockApi",
  )
  expect(mocks.some((s) => s.status === 502 && s.type === "text/html")).toBe(true)
  expect(mocks.some((s) => String(s.body).includes('"code"'))).toBe(true)
  for (const s of mocks.filter((m) => !m.type)) JSON.parse(String(s.body))
  expect(get("form-states").some((s) => s.do === "mockApi" && typeof s.delayMs === "number")).toBe(
    true,
  )
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
    'task x: steps[1].do: unknown step "nope"; use goto, http, click, fill, expectText, expectNoText, expectRole, expectCount, download, mockApi, sourceForbids',
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
  expect(parseAgent(out)).toEqual({
    ended: true,
    turns: 12,
    tokens: 1115,
    usd: 0.5,
    text: "ok",
    signet: null,
  })
  expect(parseAgent(JSON.stringify({ subtype: "error_max_turns", num_turns: 40 })).ended).toBe(
    false,
  )
  expect(() => parseAgent("boom")).toThrow("claude printed no JSON")
})

test("parseAgent counts Signet MCP tools and CLIs from the message log", () => {
  const tool = (name: string, command?: string) => ({
    type: "assistant",
    message: { content: [{ type: "tool_use", name, input: command ? { command } : {} }] },
  })
  const log = [
    { type: "system" },
    tool("mcp__signet__plan_page"),
    tool("mcp__signet__plan_page"),
    tool("mcp__signet__get_component"),
    tool("Bash", "bun /x/packages/cli/src/index.ts check"),
    tool("Bash", "bunx signet add block pricing"),
    tool("Bash", "bun create-signet-app app --describe 'a form'"),
    tool("Bash", "bun run build"),
    tool("Read"),
    { type: "result", subtype: "success", num_turns: 3, total_cost_usd: 1, result: "ok" },
  ]
  expect(parseAgent(JSON.stringify(log)).signet).toEqual({
    plan_page: 2,
    get_component: 1,
    "cli:check": 1,
    "cli:add": 1,
    "cli:describe": 1,
  })
  expect(parseAgent(JSON.stringify(log)).ended).toBe(true)
  expect(parseAgent(JSON.stringify([{ type: "result", subtype: "success" }])).signet).toEqual({})
  expect(() => parseAgent("[]")).toThrow("no result object")
})

test("the agent command prints every message, so the tool calls can be counted", () => {
  const task = loadTasks().tasks[0]!
  expect(agentArgs(ARMS.C, task, { model: "sonnet", maxTurns: 7 })).toContain("--verbose")
})

test("the rubric is a tree of yes/no checks with every group filled", () => {
  expect(validateRubric()).toEqual([])
  const ids = loadChecks().map((c) => c.id)
  for (const g of ["layout", "hierarchy", "spacing", "tokens", "states", "responsive"])
    expect(ids.some((i) => i.startsWith(`${g}.`))).toBe(true)
  expect(ids).toContain("responsive.tap-targets")
  expect(validateRubric(`${import.meta.dir}/nope.md`)[0]).toContain("does not exist")
})

test("parseJudge rolls the yes/no checks up to a percentage and rejects anything else", () => {
  const ids = ["layout.a", "layout.b", "tokens.c", "states.d"]
  const all = { "layout.a": true, "layout.b": true, "tokens.c": false, "states.d": true }
  const v = parseJudge(
    `Here: ${JSON.stringify({ checks: all, findings: [{ dimension: "tokens", severity: "serious", tile: "/ · dark · 390", note: "white" }] })}`,
    ids,
  )
  expect(v.percent).toBe(75)
  expect(v.findings[0]?.tile).toBe("/ · dark · 390")
  expect(() => parseJudge(JSON.stringify({ checks: { ...all, "tokens.c": 1 } }), ids)).toThrow(
    "tokens.c",
  )
  expect(() => parseJudge(JSON.stringify({ checks: { "layout.a": true } }), ids)).toThrow(
    "layout.b",
  )
  expect(() => parseJudge("no json", ids)).toThrow("no JSON")
})

const shot = (path: string | null = "runs/x/shots/home__1440__light.png") => [
  { page: "/", width: 1440, mode: "light" as const, path },
]

test("pairwise: pairs only same task and run with a shot, picks map to arms, order is random", () => {
  const rs = [
    result({ id: "t__A__1", task: "t", arm: "A", shots: shot() }),
    result({ id: "t__B__1", task: "t", arm: "B", shots: shot() }),
    result({ id: "t__C__1", task: "t", arm: "C", shots: shot() }),
    result({ id: "t__C__2", task: "t", arm: "C", run: 2, shots: shot() }),
    result({ id: "u__B__1", task: "u", arm: "B", shots: shot(null) }),
    result({ id: "u__A__1", task: "u", arm: "A", shots: shot() }),
  ]
  const jobs = pairJobs(rs, ["A", "B", "C"])
  expect(jobs.map((j) => `${j.task} ${j.run} ${j.a.arm}/${j.b.arm}`)).toEqual([
    "t 1 C/B",
    "t 1 B/A",
    "t 1 C/A",
  ])
  expect(armPairs(["A", "C"])).toEqual([["C", "A"]])
  expect(parsePick('{"pick":"Y"}')).toBe("Y")
  expect(parsePick('ok {"pick": "tie"}')).toBe("tie")
  expect(() => parsePick("X")).toThrow("no pick")
  expect(pickWinner("X", "B", "C")).toBe("B")
  expect(pickWinner("Y", "B", "C")).toBe("C")
  expect(pickWinner("tie", "B", "C")).toBe("tie")
  // blind: nothing in the prompt names an arm or run
  const p = pairPrompt("pricing", "/tmp/X.png", "/tmp/Y.png")
  expect(p).toContain("X: /tmp/X.png")
  expect(p).not.toMatch(/arm|__[ABC]__/i)
})

test("the judge prompt carries the rubric and a failed shot as 'No shot'", () => {
  const p = judgePrompt(
    "t",
    [{ page: "/", width: 390, mode: "dark", path: null, reason: "timeout" }],
    "/r",
  )
  expect(p).toContain("responsive.tap-targets")
  expect(p).toContain("/ · dark · 390: No shot: timeout")
  expect(
    sheetHtml("t", [{ page: "/", width: 390, mode: "dark", path: null, reason: "timeout" }], "/r"),
  ).toContain("No shot: timeout")
})

test("the report shows mean, min-max and pass@k per task and arm", () => {
  const v = (percent: number) => ({ checks: {}, percent, findings: [] })
  const rs = [
    result({ id: "s__B__1", arm: "B", run: 1, visual: v(60), usd: 1 }),
    result({ id: "s__B__2", arm: "B", run: 2, visual: v(90), usd: 3, hidden: false }),
    result({ id: "s__B__3", arm: "B", run: 3, visual: v(80), usd: 2, hidden: false }),
    result({ id: "s__A__1", arm: "A", run: 1, violations: null, hidden: false }),
    result({ id: "s__A__2", arm: "A", run: 2, violations: null, hidden: false }),
  ]
  const md = renderReport({ ...meta, runs: 3 }, rs)
  expect(md).toContain("| settings-page | B |")
  expect(md).toContain("| 33% | yes | 77% (60%–90%) |") // 1 of 3 passed, pass@3, mean of 60/90/80
  expect(md).toContain("| $2.00 ($1.00–$3.00) |")
  expect(md).toContain("| settings-page | A |")
  expect(md).toMatch(/\| settings-page \| A \|.*\| 0% \| no \|/)
  expect(passAtK(rs.slice(3))).toBe(false)
  expect(spread([5], (n) => `${n}`)).toBe("5")
  expect(spread([], (n) => `${n}`)).toBe("n/a")
})

test("the report shows blind pairwise win rates and tool use, and flags a C run with no call", () => {
  const rs = [
    result({ id: "s__B__1", arm: "B", signet: { search_docs: 2 } }),
    result({ id: "s__C__1", arm: "C", signet: { plan_page: 1, "cli:check": 2 } }),
    result({ id: "s__C__2", arm: "C", run: 2, signet: {} }),
    result({ id: "s__C__3", arm: "C", run: 3, signet: null }), // no log: not flagged
  ]
  const pairs: Pair[] = [
    { task: "s", run: 1, x: "B", y: "C", winner: "C" },
    { task: "s", run: 2, x: "C", y: "B", winner: "C" },
    { task: "s", run: 3, x: "C", y: "B", winner: "B" },
    { task: "s", run: 4, x: "B", y: "C", winner: "tie" },
  ]
  const md = renderReport(meta, rs, pairs)
  expect(md).toContain("| C vs B | 4 | 2 | 1 | 1 | 50% |")
  expect(md).toContain("| C | 3 | 2 | 1 |")
  expect(md).toContain("1/2 runs, 1 calls") // plan_page: 1 of the 2 C runs with a log
  expect(md).toContain("Flag: 1 arm C run called no Signet tool or CLI")
  expect(md).toContain("s__C__2")
  expect(md).not.toContain("s__C__3.")
  expect(runLine(1, 3, result({ arm: "C", signet: {} }))).toContain(", no Signet call")
  expect(renderReport(meta, [result({ arm: "C", signet: { plan_page: 1 } })])).toContain(
    "No arm C run went without a Signet call.",
  )
  expect(renderReport(meta, rs)).toContain("No pairwise verdicts")
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
  expect(md).toContain("| A | 1 | 100% | 100% | 0% | 0% | 0% | n/a |")
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
    runs: 3,
    dryRun: false,
  })
  expect(parseArgs(["--arms", "a,c", "--runs", "5", "--dry-run"])).toMatchObject({
    arms: ["A", "C"],
    runs: 5,
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

test("validate asks for build:all when an MCP arm has no dist, and not for arm A", () => {
  const mcp = (arms: string) =>
    validate(parseArgs(["--arms", arms])).errors.filter((e) => e.startsWith("mcp: build:"))
  expect(mcp("A")).toEqual([])
  expect(mcp("B,C")).toEqual(existsSync(MCP_BIN) ? [] : [expect.stringContaining("build:all")])
})

test("--dry-run validates tasks, arms, rubric and pairs, and exits 0 (needs build:all)", () => {
  const r = run("--dry-run")
  if (!existsSync(MCP_BIN)) return expect(r.exitCode).toBe(1)
  const checks = loadChecks().length
  expect(r.stdout.toString().trim()).toBe(
    `Dry run: 15 tasks, 3 arms valid. 3 runs each, ${checks} rubric checks, up to 135 blind pairs. No agent called.`,
  )
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
