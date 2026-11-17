import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type AgentOpts, agentArgs, parseAgent } from "./agent"
import { ARMS, ROOT, scaffold } from "./arms"
import { serveDist } from "./browser"
import { runHidden } from "./hidden"
import { judge } from "./judge"
import { takeShots, writeSheet } from "./shots"
import type { RunResult, Task } from "./types"

const AGENT_LIMIT_MS = 30 * 60_000

async function exec(cmd: string[], cwd: string, limitMs = 5 * 60_000) {
  const p = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  })
  const timer = setTimeout(() => p.kill(), limitMs)
  try {
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ])
    return { out, err, code }
  } finally {
    clearTimeout(timer)
  }
}

const hasScript = (app: string, name: string) =>
  Boolean(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).scripts?.[name])

export type RunCtx = AgentOpts & { resultsDir: string; judgeModel: string }

/** One run: fresh app, one agent session, then every score. A crash becomes `failed`; the run is still returned. */
export async function runOne(
  task: Task,
  armId: "A" | "B" | "C",
  run: number,
  ctx: RunCtx,
): Promise<RunResult> {
  const arm = ARMS[armId]
  const id = `${task.id}__${arm.id}__${run}`
  const r: RunResult = {
    id,
    task: task.id,
    arm: arm.id,
    run,
    builds: false,
    typechecks: false,
    hidden: false,
    firstTry: false,
    violations: null,
    turns: null,
    tokens: null,
    usd: null,
    wallMs: null,
    shots: [],
    sheet: null,
    visual: null,
  }
  const tmp = mkdtempSync(join(tmpdir(), "signet-eval-"))
  try {
    const app = await scaffold(arm.id, task, tmp)

    const started = Date.now()
    const p = Bun.spawn(agentArgs(arm, task, ctx), {
      cwd: app,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    const timer = setTimeout(() => p.kill(), AGENT_LIMIT_MS)
    const [out, err] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ])
    clearTimeout(timer)
    r.wallMs = Date.now() - started
    let ended = false
    try {
      const a = parseAgent(out)
      ended = a.ended
      r.turns = a.turns
      r.tokens = a.tokens
      r.usd = a.usd
    } catch (e) {
      throw new Error(
        `agent: ${e instanceof Error ? e.message : e}${err.trim() ? ` (${err.trim().split("\n").pop()})` : ""}`,
      )
    }

    r.builds = (await exec(["bun", "run", "build"], app)).code === 0
    r.typechecks =
      (
        await exec(
          hasScript(app, "typecheck") ? ["bun", "run", "typecheck"] : ["bunx", "tsc", "--noEmit"],
          app,
        )
      ).code === 0

    if (arm.check) {
      const c = await exec(
        ["bun", join(ROOT, "packages/cli/src/index.ts"), "check", "--json", "--cwd", app],
        app,
      )
      try {
        r.violations = (JSON.parse(c.out).findings as unknown[]).length
      } catch {
        r.violations = null
      }
    }

    if (r.builds) {
      const server = serveDist(join(app, "dist"))
      try {
        const base = `http://127.0.0.1:${server.port}`
        const h = await runHidden(base, task.steps)
        r.hidden = h.pass
        r.hiddenFailure = h.failure
        const rel = `runs/${id}`
        const dir = join(ctx.resultsDir, rel)
        mkdirSync(dir, { recursive: true })
        r.shots = await takeShots(base, task.pages, dir, rel)
        r.sheet = await writeSheet(
          `${task.id} · arm ${arm.id} · run ${run}`,
          r.shots,
          dir,
          rel,
          ctx.resultsDir,
        )
      } finally {
        server.stop(true)
      }
      const j = await judge(task.title, r.shots, ctx.resultsDir, ctx.judgeModel)
      r.visual = j.visual
      r.visualFailure = j.failure
    }
    r.firstTry = ended && r.builds && r.typechecks && r.hidden
  } catch (e) {
    r.failed = e instanceof Error ? e.message.split("\n")[0] : String(e)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return r
}
