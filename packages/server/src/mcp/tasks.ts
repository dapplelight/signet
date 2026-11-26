/**
 * The Tasks extension (`io.modelcontextprotocol/tasks`, SEP-2663) for tools.
 *
 * A tool marked `task` runs in the background when the calling client says it
 * supports tasks: the call answers at once with a task handle, and the client
 * polls `tasks/get` for the result. A client that did not say so gets the
 * ordinary synchronous result, so the same tool serves both.
 *
 * Tasks are only served to 2026-07-28 clients: older ones cannot declare the
 * extension. The state lives in a `TaskStore`; the SDK has no Tasks support of
 * its own, so this module speaks the three methods itself.
 */

import type { CallToolResult } from "@modelcontextprotocol/server"
import {
  fromJsonSchema,
  isInputRequiredResult,
  type McpServer,
  MissingRequiredClientCapabilityError,
  ProtocolError,
  ProtocolErrorCode,
} from "@modelcontextprotocol/server"
import type { Context } from "hono"
import { callHook } from "./errors.js"

export const TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks"

export type TaskStatus = "working" | "input_required" | "completed" | "failed" | "cancelled"

/** A JSON-RPC error object, as a failed task reports it. */
export type TaskError = { code: number; message: string; data?: unknown }

/** One task as the store keeps it. `owner` is the principal that created it ("" with no token). */
export type TaskRecord = {
  taskId: string
  owner: string
  status: TaskStatus
  statusMessage?: string
  createdAt: string
  lastUpdatedAt: string
  /** Milliseconds from `createdAt` until the task may be discarded; null keeps it. */
  ttlMs: number | null
  pollIntervalMs?: number
  /** The tool's result, once `completed` (an `isError: true` result is still `completed`). */
  result?: CallToolResult
  /** The JSON-RPC error, once `failed`. */
  error?: TaskError
}

/** How a task ends: the fields `settle` writes. */
export type TaskSettle =
  | { status: "completed"; result: CallToolResult; statusMessage?: string }
  | { status: "failed"; error: TaskError; statusMessage?: string }
  | { status: "cancelled"; statusMessage?: string }

/**
 * Where tasks live between requests. Every request may land on a different
 * instance, so on Workers or behind a load balancer this must be shared
 * storage (KV, a Durable Object, a database); `memoryTaskStore` is one process.
 */
export type TaskStore = {
  /** Store a new task. `tools/call` answers only after this resolves, so a `tasks/get` for it finds it. */
  create(task: TaskRecord): Promise<void>
  /** The task, or undefined when it never existed or its `ttlMs` has run out. */
  get(taskId: string): Promise<TaskRecord | undefined>
  /**
   * End a task that is still `working` or `input_required`, atomically: the
   * first `settle` wins and later ones do nothing, so a finishing handler
   * cannot overwrite a cancel (or the reverse). Returns the updated record, or
   * undefined when the task is missing, expired or already ended.
   */
  settle(taskId: string, end: TaskSettle): Promise<TaskRecord | undefined>
}

/** An in-process store: tasks are lost on restart and not shared between instances. */
export function memoryTaskStore(now: () => number = Date.now): TaskStore {
  const tasks = new Map<string, TaskRecord>()
  const live = (t: TaskRecord) => t.ttlMs === null || now() < Date.parse(t.createdAt) + t.ttlMs
  return {
    async create(task) {
      // ponytail: sweep on create, O(n) per task; a database store expires rows itself
      for (const [id, t] of tasks) if (!live(t)) tasks.delete(id)
      tasks.set(task.taskId, task)
    },
    async get(taskId) {
      const t = tasks.get(taskId)
      if (t && !live(t)) tasks.delete(taskId)
      return t && live(t) ? t : undefined
    },
    async settle(taskId, end) {
      const t = tasks.get(taskId)
      if (!t || !live(t) || (t.status !== "working" && t.status !== "input_required"))
        return undefined
      const next: TaskRecord = { ...t, ...end, lastUpdatedAt: new Date(now()).toISOString() }
      tasks.set(taskId, next)
      return next
    },
  }
}

/** Per tool: `true` for the defaults, or override how long the task is kept and how often to poll. */
export type TaskToolOptions = boolean | { ttlMs?: number | null; pollIntervalMs?: number }

export type TasksOptions = {
  /** Shared across requests: create it once at module scope, not per request. */
  store: TaskStore
  /** Default `ttlMs` for a new task. Default 1 hour; `null` keeps tasks until the store drops them. */
  ttlMs?: number | null
  /** Default `pollIntervalMs` clients are told to wait between polls. Default 5000. */
  pollIntervalMs?: number
}

const DEFAULT_TTL_MS = 3_600_000
const DEFAULT_POLL_MS = 5000

// A task's AbortController, so `tasks/cancel` can stop the work when it runs in
// this process. ponytail: another instance only marks the task cancelled; the
// work there ends on its own, and its late `settle` is ignored.
const running = new Map<string, AbortController>()

/** The `Task` fields every response carries. */
function taskFields(t: TaskRecord) {
  return {
    taskId: t.taskId,
    status: t.status,
    ...(t.statusMessage !== undefined ? { statusMessage: t.statusMessage } : {}),
    createdAt: t.createdAt,
    lastUpdatedAt: t.lastUpdatedAt,
    ttlMs: t.ttlMs,
    ...(t.pollIntervalMs !== undefined ? { pollIntervalMs: t.pollIntervalMs } : {}),
  }
}

/** What `tasks/get` returns: the task with its result or error inlined once it has one. */
function detailed(t: TaskRecord) {
  return {
    resultType: "complete" as const,
    ...taskFields(t),
    ...(t.status === "completed" && t.result ? { result: t.result } : {}),
    ...(t.status === "failed" && t.error ? { error: t.error } : {}),
  }
}

/** The client declared the extension on this request. */
export function clientSupportsTasks(server: McpServer): boolean {
  const ext = server.server.getClientCapabilities()?.extensions
  return ext?.[TASKS_EXTENSION_ID] !== undefined
}

type StartArgs = {
  options: TasksOptions
  tool: TaskToolOptions
  owner: string
  c: Context | undefined
  /** Runs the tool; `signal` ends when the task is cancelled, not when the request does. */
  run: (signal: AbortSignal) => Promise<CallToolResult>
}

/**
 * Make the task, run the tool in the background and return the task handle
 * (`CreateTaskResult`) for `tools/call` to answer with.
 */
export async function startTask({ options, tool, owner, c, run }: StartArgs) {
  const own = typeof tool === "object" ? tool : {}
  const now = new Date().toISOString()
  const task: TaskRecord = {
    taskId: crypto.randomUUID(), // 122 random bits: the id is a bearer secret for the task's state
    owner,
    status: "working",
    createdAt: now,
    lastUpdatedAt: now,
    ttlMs:
      own.ttlMs !== undefined
        ? own.ttlMs
        : options.ttlMs !== undefined
          ? options.ttlMs
          : DEFAULT_TTL_MS,
    pollIntervalMs: own.pollIntervalMs ?? options.pollIntervalMs ?? DEFAULT_POLL_MS,
  }
  await options.store.create(task) // durable before the handle goes out
  const abort = new AbortController()
  running.set(task.taskId, abort)
  const work = (async () => {
    try {
      const result = await run(abort.signal)
      if (isInputRequiredResult(result)) {
        // a handler that asked the client a question (`confirm`) has nobody to ask here
        await options.store.settle(task.taskId, {
          status: "failed",
          statusMessage: "This tool asked for input, which a task cannot do.",
          error: { code: -32603, message: "Internal error" },
        })
        return
      }
      await options.store.settle(task.taskId, { status: "completed", result })
    } catch {
      // `run` maps tool errors to results; a throw here is the store or the host failing
      await options.store
        .settle(task.taskId, {
          status: "failed",
          error: { code: -32603, message: "Internal error" },
        })
        .catch(() => {})
    } finally {
      running.delete(task.taskId)
    }
  })()
  callHook(() => work, c) // Workers: waitUntil keeps the isolate alive until the work ends
  return { resultType: "task" as const, ...taskFields(task) }
}

const taskIdParams = fromJsonSchema({
  type: "object",
  properties: { taskId: { type: "string" } },
  required: ["taskId"],
})
const updateParams = fromJsonSchema({
  type: "object",
  properties: { taskId: { type: "string" }, inputResponses: { type: "object" } },
  required: ["taskId"],
})

/**
 * Declare the extension and serve `tasks/get`, `tasks/update` and `tasks/cancel`
 * on `server`. Every one is refused with -32021 unless the client declared the
 * extension, and answers -32602 for a task that is not the caller's.
 */
export function attachTasks(server: McpServer, store: TaskStore, owner: string): void {
  server.server.registerCapabilities({ extensions: { [TASKS_EXTENSION_ID]: {} } })
  // The caller must be the one that created the task; anything else reads as "not found".
  const own = async (taskId: string): Promise<TaskRecord> => {
    if (!clientSupportsTasks(server)) {
      throw new MissingRequiredClientCapabilityError({
        requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } },
      })
    }
    const t = await store.get(taskId)
    if (!t || t.owner !== owner) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        "Failed to retrieve task: Task not found",
      )
    }
    return t
  }
  // The schemas above checked `taskId` is a string; their inferred type is `unknown`.
  const idOf = (params: unknown) => (params as { taskId: string }).taskId
  server.server.setRequestHandler("tasks/get", { params: taskIdParams }, async (params) => {
    return detailed(await own(idOf(params)))
  })
  // Tasks here never reach `input_required`, so there is nothing outstanding to answer: acknowledge
  // and ignore the responses, as the spec allows for keys that are not outstanding.
  server.server.setRequestHandler("tasks/update", { params: updateParams }, async (params) => {
    await own(idOf(params))
    return { resultType: "complete" as const }
  })
  server.server.setRequestHandler("tasks/cancel", { params: taskIdParams }, async (params) => {
    const taskId = idOf(params)
    await own(taskId)
    await store.settle(taskId, { status: "cancelled", statusMessage: "Cancelled by the client." })
    running.get(taskId)?.abort()
    return { resultType: "complete" as const }
  })
}
