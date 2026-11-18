import { ApiException } from "@dapplelight/signet-server/http"
import { zValidator } from "@dapplelight/signet-server/http/validate"
import { CHANNELS, type Channel, NotifyError } from "@dapplelight/signet-server/notify/notifier"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../app.ts"
import type { Services } from "../services.ts"

const channelPrefs = z.record(
  z.string(),
  z.partialRecord(z.enum(CHANNELS as [Channel, ...Channel[]]), z.boolean()),
)

/**
 * The in-app inbox and notification preferences, for the signed-in user.
 *
 *   GET  /?cursor=          { items, nextCursor, unreadCount }
 *   POST /read              { ids }
 *   POST /read-all
 *   POST /:id/archive
 *   GET  /prefs             { channels, required }
 *   PUT  /prefs             { channels }   (a required category cannot be turned off)
 */
export const notificationRoutes = (s: Services) =>
  new Hono<AppEnv>()
    .get("/", zValidator("query", z.object({ cursor: z.string().optional() })), async (c) => {
      const id = c.get("user").id
      const page = await s.notifier.inbox.list(id, c.req.valid("query"))
      return c.json({ ...page, unreadCount: await s.notifier.inbox.unreadCount(id) })
    })
    .post(
      "/read",
      zValidator("json", z.object({ ids: z.array(z.string()).max(100) })),
      async (c) => {
        await s.notifier.inbox.markRead(c.get("user").id, c.req.valid("json").ids)
        return c.json({ ok: true })
      },
    )
    .post("/read-all", async (c) => {
      await s.notifier.inbox.markAllRead(c.get("user").id)
      return c.json({ ok: true })
    })
    .post("/:id/archive", async (c) => {
      await s.notifier.inbox.archive(c.get("user").id, c.req.param("id"))
      return c.json({ ok: true })
    })
    .get("/prefs", async (c) => {
      const { channels } = await s.notifier.getPrefs(c.get("user").id)
      return c.json({ channels, required: s.notifier.required })
    })
    .put("/prefs", zValidator("json", z.object({ channels: channelPrefs })), async (c) => {
      const { channels } = await s.notifier
        .updatePrefs(c.get("user").id, c.req.valid("json"))
        .catch((e: unknown) => {
          if (e instanceof NotifyError) throw new ApiException(400, e.message, e.code)
          throw e
        })
      return c.json({ channels, required: s.notifier.required })
    })
