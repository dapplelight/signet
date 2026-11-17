/** One step of a task's hidden acceptance test. Checked field by field in tasks.ts. */
export type Step = { do: string; [field: string]: unknown }

export type Task = {
  id: string
  /** 1 (easy) to 5 (hard). */
  level: number
  title: string
  /** One sentence for `create-signet-app --describe` (arm C). */
  describe: string
  /** What the agent is told. The hidden test is never shown to it. */
  prompt: string
  /** Paths to screenshot, default ["/"]. */
  pages: string[]
  steps: Step[]
}

export type ArmId = "A" | "B" | "C"

export type Arm = {
  id: ArmId
  label: string
  /** The Signet MCP server is configured for the agent. */
  mcp: boolean
  /** MCP tools the agent may not call. */
  denyTools: string[]
  /** `signet check` is scored for this arm. */
  check: boolean
}

export type Shot = {
  page: string
  width: number
  mode: "light" | "dark"
  /** Path relative to the results folder, null when the shot failed. */
  path: string | null
  reason?: string
}

export type Visual = {
  total: number
  scores: Record<string, number>
  findings: { dimension: string; severity: string; tile: string; note: string }[]
}

export type RunResult = {
  id: string
  task: string
  arm: ArmId
  run: number
  /** Set when the run could not finish (scaffold, agent or scoring crashed). It still counts. */
  failed?: string
  builds: boolean
  typechecks: boolean
  hidden: boolean
  hiddenFailure?: string
  /** Built, typechecked and passed the hidden test in one agent session that ended normally. */
  firstTry: boolean
  /** Check findings for arms B and C, null for A. */
  violations: number | null
  turns: number | null
  tokens: number | null
  usd: number | null
  wallMs: number | null
  shots: Shot[]
  sheet: string | null
  visual: Visual | null
  visualFailure?: string
}

export type Meta = {
  date: string
  model: string
  tasks: string[]
  arms: ArmId[]
  runs: number
  maxTurns: number
}
