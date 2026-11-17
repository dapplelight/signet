import type { Arm, Task } from "./types"

/** Added to every task prompt, identically for all arms. */
export const COMMON =
  "Build it in the current folder. `bun run build` and `bun run typecheck` must pass, and `bun run dev` serves it on port 5173. Do not ask questions. When you finish, reply with one short sentence."

export const promptFor = (t: Task) => `${t.prompt}\n\n${COMMON}`

export type AgentOpts = { model: string; maxTurns: number }

/** The `claude -p` command for one run. Same model, prompt and tool set per arm; only the MCP server and its denied tools differ. */
export function agentArgs(arm: Arm, task: Task, o: AgentOpts): string[] {
  const allow = [
    "Bash",
    "Edit",
    "Write",
    "Read",
    "Glob",
    "Grep",
    ...(arm.mcp ? ["mcp__signet"] : []),
  ]
  const args = [
    "claude",
    "-p",
    promptFor(task),
    "--output-format",
    "json",
    "--model",
    o.model,
    "--max-turns",
    String(o.maxTurns),
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    allow.join(","),
  ]
  if (arm.mcp) args.push("--mcp-config", ".mcp.json", "--strict-mcp-config")
  if (arm.denyTools.length) args.push("--disallowedTools", arm.denyTools.join(","))
  return args
}

export type AgentOutcome = {
  /** The agent ended normally: not an error and not out of turns. */
  ended: boolean
  turns: number
  tokens: number
  usd: number
  text: string
}

/** Reads the JSON object `claude -p --output-format json` prints. Throws when it is not one. */
export function parseAgent(stdout: string): AgentOutcome {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(stdout)
  } catch {
    throw new Error(`claude printed no JSON: ${stdout.trim().slice(0, 120) || "empty output"}`)
  }
  const u = (j.usage ?? {}) as Record<string, number | undefined>
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  return {
    ended: j.is_error !== true && j.subtype === "success",
    turns: n(j.num_turns),
    tokens:
      n(u.input_tokens) +
      n(u.output_tokens) +
      n(u.cache_creation_input_tokens) +
      n(u.cache_read_input_tokens),
    usd: n(j.total_cost_usd),
    text: typeof j.result === "string" ? j.result : "",
  }
}
