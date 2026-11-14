/**
 * Per-user MCP tools for sessions and API keys: `list_my_sessions`,
 * `revoke_session`, `list_api_keys`, `revoke_api_key`.
 *
 * Revokes go through `requireApproval`. No tool returns a token, a hash or a
 * code. The user is the caller's token `sub` (oauth-rs `requireToken`), or
 * whatever `userOf` returns; with no user every tool refuses.
 *
 *   mountMcp(app, "/mcp", { ..., tools: [...authTools({ sessions, apiKeys }), ...mine] })
 */

import { z } from "zod"
import { toolErrorResult } from "../mcp/errors.js"
import { requireApproval } from "../mcp/interaction.js"
import { defineTool, type McpTool, type ToolContext, toolResult } from "../mcp/server.js"
import { type ApiKeyStore, listApiKeys, revokeApiKey } from "./api-keys.js"
import type { SessionStore } from "./sessions.js"

export type AuthToolsOptions = {
  /** Adds `list_my_sessions` and `revoke_session`. */
  sessions?: SessionStore
  /** Adds `list_api_keys` and `revoke_api_key`. */
  apiKeys?: ApiKeyStore
  /** The signed-in user. Default: the verified token's `sub`. */
  userOf?: (ctx: ToolContext) => string | undefined
}

const UNAUTHORIZED = () =>
  toolResult(toolErrorResult({ code: "UNAUTHORIZED", message: "Sign in first." }))

export function authTools(opts: AuthToolsOptions): McpTool[] {
  const userOf = opts.userOf ?? ((ctx: ToolContext) => ctx.token?.claims.sub)
  const tools: McpTool[] = []
  const { sessions, apiKeys } = opts

  if (sessions)
    tools.push(
      defineTool({
        name: "list_my_sessions",
        description:
          "List the signed-in user's active sessions (devices): id, device, IP, created and last seen.",
        annotations: { readOnlyHint: true },
        handler: async (_input, ctx) => {
          const sub = userOf(ctx)
          if (!sub) return UNAUTHORIZED()
          return { sessions: (await sessions.listByUser(sub)).map(({ sub: _s, ...r }) => r) }
        },
      }),
      defineTool({
        name: "revoke_session",
        description:
          "Sign one of the user's sessions out, by id from list_my_sessions. Asks first.",
        annotations: { destructiveHint: true, idempotentHint: true },
        input: z.object({ id: z.string().min(1).max(128) }),
        handler: async (input, ctx) => {
          const sub = userOf(ctx)
          if (!sub) return UNAUTHORIZED()
          const target = await sessions.get(input.id)
          if (!target || target.sub !== sub) return "No such session."
          const gate = await requireApproval(ctx, {
            summary: `Sign out ${target.device}`,
            details: { device: target.device, lastSeen: new Date(target.lastSeenAt).toISOString() },
            args: input,
          })
          if (gate) return gate
          await sessions.revoke(input.id)
          return `Signed out ${target.device}.`
        },
      }),
    )

  if (apiKeys)
    tools.push(
      defineTool({
        name: "list_api_keys",
        description:
          "List the signed-in user's API keys: id, name, first characters, scopes, created, last used, expiry. Never the secret.",
        annotations: { readOnlyHint: true },
        handler: async (_input, ctx) => {
          const sub = userOf(ctx)
          if (!sub) return UNAUTHORIZED()
          return { keys: await listApiKeys(apiKeys, sub) }
        },
      }),
      defineTool({
        name: "revoke_api_key",
        description: "Revoke one of the user's API keys, by id from list_api_keys. Asks first.",
        annotations: { destructiveHint: true, idempotentHint: true },
        input: z.object({ id: z.string().min(1).max(128) }),
        handler: async (input, ctx) => {
          const sub = userOf(ctx)
          if (!sub) return UNAUTHORIZED()
          const key = (await listApiKeys(apiKeys, sub)).find((k) => k.id === input.id)
          if (!key) return "No such API key."
          const gate = await requireApproval(ctx, {
            summary: `Revoke API key "${key.name}" (${key.start}…)`,
            details: { name: key.name, start: key.start, scopes: key.scopes },
            args: input,
          })
          if (gate) return gate
          await revokeApiKey(apiKeys, sub, input.id)
          return `Revoked API key "${key.name}".`
        },
      }),
    )
  return tools
}
