import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Step, Task } from "./types"

export const TASKS_DIR = join(import.meta.dir, "../tasks")

type Kind = "string" | "number"
/** Required and optional fields of each hidden-test step. */
export const STEPS: Record<string, { req: Record<string, Kind>; opt: Record<string, Kind> }> = {
  goto: { req: { path: "string" }, opt: {} },
  http: { req: { path: "string", status: "number" }, opt: { contains: "string" } },
  click: { req: { role: "string", name: "string" }, opt: {} },
  fill: { req: { label: "string", value: "string" }, opt: {} },
  expectText: { req: { text: "string" }, opt: {} },
  expectNoText: { req: { text: "string" }, opt: {} },
  expectRole: { req: { role: "string", name: "string" }, opt: {} },
  expectCount: { req: { role: "string", min: "number" }, opt: {} },
  download: { req: { role: "string", name: "string", contains: "string" }, opt: {} },
}

/** Every problem with a task, as "task <id>: <field>: <what is wrong>". */
export function validateTask(t: unknown, id: string): string[] {
  const errors: string[] = []
  const bad = (field: string, msg: string) => errors.push(`task ${id}: ${field}: ${msg}`)
  if (typeof t !== "object" || t === null) return [`task ${id}: file: must be a JSON object`]
  const o = t as Record<string, unknown>
  if (o.id !== id) bad("id", `must equal the file name "${id}"`)
  if (!Number.isInteger(o.level) || (o.level as number) < 1 || (o.level as number) > 5)
    bad("level", "must be a whole number from 1 to 5")
  for (const f of ["title", "describe", "prompt"])
    if (typeof o[f] !== "string" || !(o[f] as string).trim()) bad(f, "must be a non-empty string")
  if (
    !Array.isArray(o.pages) ||
    !o.pages.length ||
    o.pages.some((p) => typeof p !== "string" || !p.startsWith("/"))
  )
    bad("pages", 'must be a non-empty list of paths starting with "/"')
  if (!Array.isArray(o.steps) || !o.steps.length) bad("steps", "must be a non-empty list")
  else
    for (const [i, s] of (o.steps as unknown[]).entries()) {
      const at = `steps[${i}]`
      if (typeof s !== "object" || s === null) {
        bad(at, "must be an object")
        continue
      }
      const step = s as Step
      const spec = STEPS[step.do]
      if (!spec) {
        bad(`${at}.do`, `unknown step "${step.do}"; use ${Object.keys(STEPS).join(", ")}`)
        continue
      }
      for (const [k, kind] of Object.entries(spec.req))
        if (typeof step[k] !== kind) bad(`${at}.${k}`, `${step.do} needs a ${kind}`)
      for (const k of Object.keys(step))
        if (k !== "do" && !(k in spec.req) && !(k in spec.opt))
          bad(`${at}.${k}`, `${step.do} has no field "${k}"`)
    }
  return errors
}

/** Loads tasks/*.json. Returns every task that parsed plus every error found. */
export function loadTasks(dir = TASKS_DIR): { tasks: Task[]; errors: string[] } {
  const tasks: Task[] = []
  const errors: string[] = []
  if (!existsSync(dir)) return { tasks, errors: [`tasks: folder: ${dir} does not exist`] }
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const id = file.replace(/\.json$/, "")
    let json: unknown
    try {
      json = JSON.parse(readFileSync(join(dir, file), "utf8"))
    } catch {
      errors.push(`task ${id}: file: not valid JSON`)
      continue
    }
    const found = validateTask(json, id)
    if (found.length) errors.push(...found)
    else tasks.push(json as Task)
  }
  return { tasks, errors }
}

/** Sorted easy to hard, then by id. */
export const byLevel = (a: Task, b: Task) => a.level - b.level || a.id.localeCompare(b.id)
