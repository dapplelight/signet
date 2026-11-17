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
    "--verbose", // with json, prints every message, so the tool calls can be counted
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
  /** Signet tools and CLIs called, name to count. Null when the output has no message log. */
  signet: Record<string, number> | null
}

const MCP_PREFIX = "mcp__signet__"
const CLI = String.raw`(?:\bsignet|cli/src/index\.ts)\s+`
/** Bash commands that count as Signet CLI use. `check` and `add` run through the signet bin or the repo's cli entry. */
const CLI_CALLS: [string, RegExp][] = [
  ["cli:check", new RegExp(`${CLI}check\\b`)],
  ["cli:add", new RegExp(`${CLI}add\\b`)],
  ["cli:describe", /--describe\b/],
]

type Message = {
  type?: string
  message?: { content?: { type?: string; name?: string; input?: { command?: unknown } }[] }
}

/** Counts the Signet MCP tools (by name) and CLI commands (from Bash) in the assistant messages. */
export function signetCalls(messages: Message[]): Record<string, number> {
  const counts: Record<string, number> = {}
  const add = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1
  }
  for (const m of messages)
    if (m.type === "assistant" && Array.isArray(m.message?.content))
      for (const b of m.message.content) {
        if (b.type !== "tool_use" || typeof b.name !== "string") continue
        if (b.name.startsWith(MCP_PREFIX)) add(b.name.slice(MCP_PREFIX.length))
        else if (b.name === "Bash" && typeof b.input?.command === "string") {
          const cmd = b.input.command
          for (const [name, rx] of CLI_CALLS) if (rx.test(cmd)) add(name)
        }
      }
  return counts
}

/**
 * Reads what `claude -p --output-format json --verbose` prints: an array of messages that ends
 * with the result object. A lone result object is read too, with no tool log. Throws when it is neither.
 */
export function parseAgent(stdout: string): AgentOutcome {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(`claude printed no JSON: ${stdout.trim().slice(0, 120) || "empty output"}`)
  }
  const log = Array.isArray(parsed) ? (parsed as Message[]) : null
  const j = (log ? [...log].reverse().find((m) => m?.type === "result") : parsed) as
    | Record<string, unknown>
    | undefined
  if (!j || typeof j !== "object") throw new Error("claude printed no result object")
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
    signet: log ? signetCalls(log) : null,
  }
}
