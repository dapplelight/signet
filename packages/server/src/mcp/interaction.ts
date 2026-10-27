/**
 * Two things app-a's MCP proposal asked for, built on the SDK's own
 * multi-round-trip input and progress notifications rather than a new
 * mechanism:
 *
 *   confirm(...)  ask before a destructive action, once per call
 *   progress(...) report progress on a long-running tool
 *
 * Both are plain functions a handler calls with its `ToolContext` — no new
 * registration shape, so they work with `defineTool` as it stands.
 */

import { inputRequired, inputResponse, isInputRequiredResult } from "@modelcontextprotocol/server"
import type { ToolContext } from "./server.js"

const CONFIRM_KEY = "signet_confirm"

/** The signed state `confirm()` mints and re-checks on the retry. */
export type ConfirmPayload = { tool: string; id: string; fp: string }

/**
 * `confirm()`'s outcome:
 *   "confirmed"   the person said yes, to THIS call's arguments (see `args`)
 *   "declined"    the person said no, cancelled, or the answer didn't check out
 *   "unsupported" the client declared no elicitation capability — do not ask;
 *                 fall back to a plain confirmation flag / dry-run instead
 */
export type ConfirmResult = "confirmed" | "declined" | "unsupported"

export type ConfirmOptions = {
  /** Shown to the person approving the action. */
  message: string
  /**
   * A short summary of what will change ("3 transactions, ₹4,200 total"),
   * shown alongside `message`. Never a full dump of the affected rows —
   * that is what the tool's own preview/dry-run should be for.
   */
  detail?: string
  /**
   * A JSON-serializable snapshot of the call's real arguments. When
   * `createMcpServer` was given a `confirm.key`, the accepted answer is
   * bound to this exact snapshot: a retry whose args hash differently reads
   * as `"declined"`, even if it replays an otherwise-valid answer from a
   * different call. Omit only when the tool truly has nothing worth binding
   * to (no key: comparing an id alone would offer nothing `args` doesn't).
   */
  args?: unknown
  /** Distinguishes this confirmation from another one the same tool might ask for in a later call. Default: the tool's name. */
  key?: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, canonicalize(obj[k])]),
    )
  }
  return value
}

async function fingerprint(args: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonicalize(args ?? null))),
  )
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Ask before a destructive action, once. On the first call this returns a
 * `never`-typed sentinel that IS an `inputRequired(...)` result — return it
 * directly:
 *
 * ```ts
 * handler: async (input, ctx) => {
 *   const ok = await confirm(ctx, { message: `Delete ${input.count} transactions?`, args: input })
 *   if (isConfirmPending(ok)) return ok
 *   if (ok === "unsupported") {
 *     if (!input.confirmDeleteAll) return "Pass confirmDeleteAll to delete without asking."
 *   } else if (ok !== "confirmed") {
 *     return "Cancelled."
 *   }
 *   await reallyDelete(input)
 *   return "Deleted."
 * }
 * ```
 *
 * `"unsupported"` means the client declared no elicitation capability —
 * never ask a client that cannot answer; fall back to the tool's own
 * pre-confirmation flag or a dry-run step instead, the way a client with no
 * multi-round-trip support has always been handled. `"declined"` covers a
 * no, a cancel, and — when `args` is given and `createMcpServer` has a
 * `confirm.key` — an accepted answer whose arguments no longer match what
 * was asked about. Only `"confirmed"` means run the action.
 *
 * Without a `confirm.key` configured, `confirm()` still asks and still
 * returns `"confirmed"`/`"declined"`/`"unsupported"`, but cannot detect a
 * client that answers "yes" to one call and replays that answer for another
 * — bind `args` and configure the key to close that gap.
 */
export async function confirm(
  ctx: ToolContext,
  { message, detail, args, key }: ConfirmOptions,
): Promise<ConfirmResult | ReturnType<typeof inputRequired>> {
  const id = key ?? `${CONFIRM_KEY}:${ctx.tool}`
  const view = inputResponse(ctx.mcp.mcpReq.inputResponses, id)

  if (view.kind === "missing") {
    // Never elicit a client that cannot answer: it would only hang or error.
    if (!ctx.confirmSupport.getClientCapabilities()?.elicitation) return "unsupported"
    const payload: ConfirmPayload = { tool: ctx.tool, id, fp: await fingerprint(args) }
    const requestState = await ctx.confirmSupport.mint?.(payload)
    return inputRequired({
      inputRequests: {
        [id]: inputRequired.elicit({
          message: detail ? `${message}\n\n${detail}` : message,
          requestedSchema: {
            type: "object",
            properties: { confirm: { type: "boolean", title: "Confirm" } },
            required: ["confirm"],
          },
        }),
      },
      ...(requestState ? { requestState } : {}),
    })
  }

  // decline/cancel, or an accept whose content did not carry `confirm`, all
  // read as "no": a malformed or refused answer must never run the action.
  if (view.kind !== "elicit" || view.action !== "accept" || view.content?.confirm !== true) {
    return "declined"
  }

  // Signed binding, when configured. A tampered or expired requestState
  // never reaches this line — the SDK's seam rejects the whole retry with
  // -32602 before the handler runs. What we still have to check ourselves:
  // that THIS retry's arguments are the ones the confirmation was minted
  // for. Re-deriving the fingerprint and comparing (rather than trusting
  // that a verified requestState implies matching args) is what stops a
  // client from getting "yes" for one call and replaying it against another.
  if (ctx.confirmSupport.mint) {
    const state = ctx.mcp.mcpReq.requestState<ConfirmPayload>()
    if (
      !state ||
      state.tool !== ctx.tool ||
      state.id !== id ||
      state.fp !== (await fingerprint(args))
    )
      return "declined"
  }
  return "confirmed"
}

/** What `confirm` returns while waiting for the client's answer. Narrows the union back to the pending branch. */
export function isConfirmPending(
  value: ConfirmResult | ReturnType<typeof inputRequired>,
): value is ReturnType<typeof inputRequired> {
  return isInputRequiredResult(value)
}

/**
 * Report progress on a long-running tool (an import, a bulk export). A no-op
 * when the caller sent no `progressToken` — most callers, including every
 * LLM client today, do not — so a handler can call it unconditionally.
 *
 * `done`/`total` follow the spec's own fields; `message` is optional context
 * ("Row 4,200 of 10,000"). Never throws: a client that dropped the connection
 * mid-import must not fail the import.
 */
export async function progress(
  ctx: ToolContext,
  done: number,
  total?: number,
  message?: string,
): Promise<void> {
  const token = (ctx.mcp.mcpReq._meta as { progressToken?: string | number } | undefined)
    ?.progressToken
  if (token === undefined) return
  try {
    await ctx.mcp.mcpReq.notify({
      method: "notifications/progress",
      params: {
        progressToken: token,
        progress: done,
        ...(total !== undefined ? { total } : {}),
        ...(message ? { message } : {}),
      },
    })
  } catch {
    // The client may have gone away mid-notification; the tool call itself continues.
  }
}
