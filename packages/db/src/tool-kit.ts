/**
 * The plain MCP tool shape signet-db's tool factories return (`name`,
 * `description`, `inputSchema` as JSON Schema, `annotations`,
 * `run(input, ctx)`), which signet-server's `createMcpServer({ tools })`
 * takes, plus the approval gate every write tool goes through.
 */

import { SignetDbError } from "./errors.js"

export type ApprovalRequest = { summary: string; details: Record<string, unknown>; args: unknown }

/** Undefined = approved; anything else is returned as the tool result. */
export type Approve = (ctx: unknown, request: ApprovalRequest) => Promise<unknown> | unknown

export type PlainTool = {
  readonly name: string
  readonly description: string
  readonly annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint?: boolean
  }
  readonly inputSchema: Record<string, unknown>
  run(input: Record<string, unknown>, ctx?: unknown): Promise<unknown>
}

export const needsApproval = (r: ApprovalRequest) => ({
  isError: true,
  content: [
    {
      type: "text",
      text: `APPROVAL_REQUIRED: Needs a person's approval: ${r.summary}. Nothing was changed.`,
    },
  ],
  structuredContent: {
    success: false,
    code: "APPROVAL_REQUIRED",
    error: `Needs approval: ${r.summary}`,
    approval: { summary: r.summary, details: r.details },
  },
})

export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

export const bad = (msg: string) => new SignetDbError("BAD_INPUT", msg)

/** A required non-empty string argument. */
export const str = (input: Record<string, unknown>, key: string): string => {
  const v = input[key]
  if (typeof v !== "string" || !v) throw bad(`${key} is required (a string).`)
  return v
}

/** Run `act` only if `approve` returns undefined; with no `approve`, change nothing. */
export async function gated(
  approve: Approve | undefined,
  ctx: unknown,
  request: ApprovalRequest,
  act: () => Promise<unknown>,
): Promise<unknown> {
  const gate = approve ? await approve(ctx, request) : needsApproval(request)
  return gate !== undefined ? gate : act()
}
