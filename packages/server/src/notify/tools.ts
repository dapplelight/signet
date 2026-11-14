/**
 * MCP tools for notifications: `list_my_notifications`, `notification_prefs`,
 * `update_prefs` (the signed-in user's own), and `send_notification` (staff
 * only, through `requireApproval`).
 *
 *   createMcpServer({ tools: [...notifyTools({ notifier, isStaff: (ctx) => ctx.token?.claims.role === "staff" })] })
 *
 * No tool returns a delivery body or an address: history shows masked
 * addresses and statuses only.
 */

import { z } from "zod"
import { toolErrorResult } from "../mcp/errors.js"
import { requireApproval } from "../mcp/interaction.js"
import { defineTool, type McpTool, type ToolContext, toolResult } from "../mcp/server.js"
import { CHANNELS, type Channel, type Notifier, NotifyError, type Templates } from "./notifier.js"

export type NotifyToolsOptions<T extends Templates> = {
  notifier: Notifier<T>
  /** The signed-in user. Default: the verified token's `sub`. */
  userOf?: (ctx: ToolContext) => string | undefined
  /** Adds `send_notification` for callers this returns true for. Absent: no send tool. */
  isStaff?: (ctx: ToolContext) => boolean | Promise<boolean>
}

const err = (code: string, message: string) => toolResult(toolErrorResult({ code, message }))
const channel = z.enum(CHANNELS as [Channel, ...Channel[]])

export function notifyTools<T extends Templates>(opts: NotifyToolsOptions<T>): McpTool[] {
  const { notifier } = opts
  const userOf = opts.userOf ?? ((ctx: ToolContext) => ctx.token?.claims.sub)
  const tools: McpTool[] = [
    defineTool({
      name: "list_my_notifications",
      description:
        "List the signed-in user's in-app notifications, newest first, with the unread count. Pass `cursor` from the previous page.",
      annotations: { readOnlyHint: true },
      input: z.object({
        cursor: z.string().max(128).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        archived: z.boolean().optional(),
      }),
      handler: async (input, ctx) => {
        const sub = userOf(ctx)
        if (!sub) return err("UNAUTHORIZED", "Sign in first.")
        const [page, unread] = await Promise.all([
          notifier.inbox.list(sub, {
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.limit ? { limit: input.limit } : {}),
            ...(input.archived ? { archived: true } : {}),
          }),
          notifier.inbox.unreadCount(sub),
        ])
        return { ...page, unread }
      },
    }),
    defineTool({
      name: "notification_prefs",
      description:
        "Show the signed-in user's notification preferences: per category and channel, quiet hours, and which categories cannot be turned off.",
      annotations: { readOnlyHint: true },
      handler: async (_input, ctx) => {
        const sub = userOf(ctx)
        if (!sub) return err("UNAUTHORIZED", "Sign in first.")
        return { ...(await notifier.getPrefs(sub)), required: notifier.required }
      },
    }),
    defineTool({
      name: "update_prefs",
      description:
        "Change the signed-in user's notification preferences. `channels` is { category: { channel: true|false } }; `quietHours` is { start: 'HH:MM', end: 'HH:MM', timezone? } or null to clear. Required categories cannot be turned off.",
      annotations: { idempotentHint: true },
      input: z.object({
        channels: z.record(z.string().max(64), z.partialRecord(channel, z.boolean())).optional(),
        quietHours: z
          .object({
            start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
            end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
            timezone: z.string().max(64).optional(),
          })
          .nullable()
          .optional(),
      }),
      handler: async (input, ctx) => {
        const sub = userOf(ctx)
        if (!sub) return err("UNAUTHORIZED", "Sign in first.")
        try {
          return await notifier.updatePrefs(sub, {
            ...(input.channels ? { channels: input.channels } : {}),
            ...(input.quietHours !== undefined ? { quietHours: input.quietHours } : {}),
          })
        } catch (e) {
          if (e instanceof NotifyError) return err(e.code, e.message)
          if (e instanceof RangeError) return err("BAD_TIMEZONE", "Unknown time zone.")
          throw e
        }
      },
    }),
  ]

  if (opts.isStaff) {
    const isStaff = opts.isStaff
    tools.push(
      defineTool({
        name: "send_notification",
        description: `Staff only. Send a notification event to one user. Events: ${Object.keys(notifier.templates).join(", ")}. Asks first.`,
        annotations: { destructiveHint: false, openWorldHint: true },
        input: z.object({
          userId: z.string().min(1).max(128),
          event: z.string().min(1).max(128),
          data: z.record(z.string(), z.unknown()),
          channels: z.array(channel).optional(),
        }),
        handler: async (input, ctx) => {
          if (!userOf(ctx)) return err("UNAUTHORIZED", "Sign in first.")
          if (!(await isStaff(ctx))) return err("FORBIDDEN", "Staff only.")
          const t = notifier.templates[input.event]
          if (!t) return err("NOT_FOUND", `No event "${input.event}".`)
          if (!t.data.safeParse(input.data).success)
            return err("BAD_DATA", `Data does not match "${input.event}".`)
          const gate = await requireApproval(ctx, {
            summary: `Send "${input.event}" to user ${input.userId}`,
            details: {
              event: input.event,
              userId: input.userId,
              channels: input.channels ?? "all",
            },
            args: input,
          })
          if (gate) return gate
          const results = await notifier.notify(
            input.userId,
            input.event,
            input.data as never,
            input.channels ? { channels: input.channels } : {},
          )
          return { results }
        },
      }),
    )
  }
  return tools
}
