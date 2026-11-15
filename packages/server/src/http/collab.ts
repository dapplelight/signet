/**
 * HTTP routes for signet-db's record collaboration (`createCollab`):
 * comments with @mentions, the mention picker, the activity timeline, and
 * version history with diff, restore and undo. Requires `hono` and `zod`.
 *
 * Takes the store structurally, so this package does not depend on
 * signet-db. Mount after `tenant()`: every route acts in the request's
 * tenant, and the store checks membership and access itself, so a record of
 * another org, an unknown table or a non-member reads as 404.
 *
 *   app.use("/api/*", tenant({ orgs, rootDomain: "app.example" }))
 *   app.route("/api/collab", collabRoutes({ collab, userId: (c) => c.get("session")?.sub }))
 *
 *   GET    /mentions?q=                        org members to mention
 *   GET    /:table/:id/comments                threads with replies
 *   POST   /:table/:id/comments                { body, parentId? }
 *   PATCH  /comments/:commentId                { body }   its author
 *   DELETE /comments/:commentId                its author, or comments:moderate
 *   GET    /:table/:id/timeline?before&limit   { items, nextCursor }
 *   GET    /:table/:id/versions?before&limit   newest first, each with its changes
 *   GET    /:table/:id/versions/diff?from&to   { from, to, changes }
 *   POST   /:table/:id/versions/:n/restore     <table>:write
 *   POST   /:table/:id/undo                    { expected? } <table>:write; 409 on conflict
 *
 * Mentions are sent by the store's `notify`; `notifyMentions(notifier)` wires
 * it to signet-server's notifier with the `comment.mention` template from
 * `mentionTemplates()`, keyed so nobody is told twice.
 */

import { type Context, Hono } from "hono"
import { z } from "zod"
import { defineTemplates, escapeHtml } from "../notify/notifier.js"
import { type ApiErrorStatus, ApiException } from "./errors.js"
import { currentTenant } from "./orgs.js"

type Who = { orgId: string; userId: string }
type Ref = { table: string; id: string }

/** What `collabRoutes` needs: signet-db's `createCollab(...)`, as it is. */
export type CollabStore = {
  comments(who: Who, ref: Ref): Promise<unknown>
  addComment(
    who: Who,
    ref: Ref,
    input: { body: string; parentId?: string | null },
  ): Promise<unknown>
  editComment(who: Who, id: string, input: { body: string }): Promise<unknown>
  deleteComment(who: Who, id: string): Promise<void>
  mentionable(who: Who, query?: string, limit?: number): Promise<unknown>
  timeline(who: Who, ref: Ref, opts?: { limit?: number; before?: string }): Promise<unknown>
  versions(who: Who, ref: Ref, opts?: { limit?: number; before?: number }): Promise<unknown>
  diff(who: Who, ref: Ref, from: number, to: number): Promise<unknown>
  restore(who: Who, ref: Ref, n: number): Promise<unknown>
  undo(who: Who, ref: Ref, opts?: { expected?: number }): Promise<unknown>
}

export type CollabRoutesOptions = {
  collab: CollabStore
  /** The signed-in user's id, e.g. `(c) => c.get("session")?.sub`. Undefined is 401. */
  userId: (c: Context) => string | null | undefined | Promise<string | null | undefined>
}

/** signet-db's OrgError (by shape): a SignetDbError with an HTTP status. */
const isStatusError = (e: unknown): e is Error & { status: ApiErrorStatus; code: string } =>
  e instanceof Error &&
  e.name === "SignetDbError" &&
  typeof (e as { status?: unknown }).status === "number" &&
  typeof (e as { code?: unknown }).code === "string"

const body = async (c: Context): Promise<Record<string, unknown>> => {
  const text = await c.req.text()
  if (!text) return {}
  try {
    const v = JSON.parse(text)
    if (v && typeof v === "object" && !Array.isArray(v)) return v
  } catch {}
  throw new ApiException(400, "The body must be a JSON object", "INVALID_JSON")
}

const int = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined || v === "") return undefined
  if (!/^\d{1,9}$/.test(v))
    throw new ApiException(400, `${name} must be a whole number.`, "VALIDATION_FAILED", {
      formErrors: [],
      fieldErrors: { [name]: ["Must be a whole number"] },
    })
  return Number(v)
}

const text = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v.trim())
    throw new ApiException(400, `${name} is required.`, "VALIDATION_FAILED", {
      formErrors: [],
      fieldErrors: { [name]: ["Required"] },
    })
  return v
}

export function collabRoutes(opts: CollabRoutesOptions) {
  const { collab } = opts
  const who = async (c: Context): Promise<Who> => {
    const userId = await opts.userId(c)
    if (!userId) throw new ApiException(401, "Sign in first.", "UNAUTHORIZED")
    return { orgId: currentTenant(c).id, userId }
  }
  const ref = (c: Context): Ref => ({
    table: c.req.param("table") ?? "",
    id: c.req.param("id") ?? "",
  })

  const app = new Hono()
  app.onError((e) => {
    if (isStatusError(e)) throw new ApiException(e.status, e.message, e.code)
    throw e
  })
  return app
    .get("/mentions", async (c) =>
      c.json({
        people: await collab.mentionable(
          await who(c),
          c.req.query("q") ?? "",
          int(c.req.query("limit"), "limit"),
        ),
      }),
    )
    .patch("/comments/:commentId", async (c) => {
      const b = await body(c)
      const comment = await collab.editComment(await who(c), c.req.param("commentId"), {
        body: text(b.body, "body"),
      })
      return c.json({ comment })
    })
    .delete("/comments/:commentId", async (c) => {
      await collab.deleteComment(await who(c), c.req.param("commentId"))
      return c.json({ deleted: 1 })
    })
    .get("/:table/:id/comments", async (c) =>
      c.json({ threads: await collab.comments(await who(c), ref(c)) }),
    )
    .post("/:table/:id/comments", async (c) => {
      const b = await body(c)
      const parentId = typeof b.parentId === "string" && b.parentId ? b.parentId : null
      const comment = await collab.addComment(await who(c), ref(c), {
        body: text(b.body, "body"),
        parentId,
      })
      return c.json({ comment }, 201)
    })
    .get("/:table/:id/timeline", async (c) => {
      const before = c.req.query("before")
      const limit = int(c.req.query("limit"), "limit")
      return c.json(
        await collab.timeline(await who(c), ref(c), {
          ...(before ? { before } : {}),
          ...(limit ? { limit } : {}),
        }),
      )
    })
    .get("/:table/:id/versions", async (c) => {
      const before = int(c.req.query("before"), "before")
      const limit = int(c.req.query("limit"), "limit")
      return c.json({
        versions: await collab.versions(await who(c), ref(c), {
          ...(before ? { before } : {}),
          ...(limit ? { limit } : {}),
        }),
      })
    })
    .get("/:table/:id/versions/diff", async (c) => {
      const from = int(c.req.query("from"), "from")
      const to = int(c.req.query("to"), "to")
      if (from === undefined || to === undefined)
        throw new ApiException(400, "from and to are required.", "VALIDATION_FAILED")
      return c.json(await collab.diff(await who(c), ref(c), from, to))
    })
    .post("/:table/:id/versions/:n/restore", async (c) =>
      c.json(await collab.restore(await who(c), ref(c), int(c.req.param("n"), "n") ?? 0)),
    )
    .post("/:table/:id/undo", async (c) => {
      const e = (await body(c)).expected
      if (e !== undefined && !(typeof e === "number" && Number.isInteger(e) && e > 0))
        throw new ApiException(400, "expected must be a version number.", "VALIDATION_FAILED")
      return c.json(await collab.undo(await who(c), ref(c), e === undefined ? {} : { expected: e }))
    })
}

/** For `hc<CollabRoutes>`: import it with `import type`. */
export type CollabRoutes = ReturnType<typeof collabRoutes>

// ------------------------------------------------------------- notifications

/** signet-db's `Mention`: what the store's `notify` gets per person. */
export type MentionData = {
  to: string
  by: string
  byName: string
  orgId: string
  table: string
  rowId: string
  commentId: string
  excerpt: string
  key: string
}

const mentionSchema = z.object({
  to: z.string(),
  by: z.string(),
  byName: z.string(),
  orgId: z.string(),
  table: z.string(),
  rowId: z.string(),
  commentId: z.string(),
  excerpt: z.string(),
  key: z.string(),
  url: z.string().optional(),
})

/**
 * The `comment.mention` template (email and in-app, category "mentions", so
 * people can turn it off in preferences). Spread it into your templates.
 * `url` links to the record, e.g. `(m) => \`https://app.example/${m.table}/${m.rowId}\``.
 */
export function mentionTemplates(o: { url?: (m: MentionData) => string } = {}) {
  const link = (d: z.output<typeof mentionSchema>) => d.url ?? o.url?.(d)
  return defineTemplates({
    "comment.mention": {
      category: "mentions",
      data: mentionSchema,
      en: {
        email: {
          subject: (d) => `${d.byName} mentioned you`,
          html: (d) => {
            const url = link(d)
            return `<p><strong>${escapeHtml(d.byName)}</strong> mentioned you:</p><blockquote>${escapeHtml(d.excerpt)}</blockquote>${url ? `<p><a href="${escapeHtml(url)}">Open</a></p>` : ""}`
          },
        },
        inApp: {
          title: (d) => `${d.byName} mentioned you`,
          body: (d) => d.excerpt,
          link: (d) => link(d) ?? "",
        },
      },
    },
  })
}

/**
 * The store's `notify` for signet-server's notifier: sends `comment.mention`
 * with the mention's key as the idempotency key. Errors are the caller's to log.
 */
export function notifyMentions(notifier: {
  notify(
    userId: string,
    event: "comment.mention",
    data: MentionData,
    opts: { idempotencyKey: string },
  ): Promise<unknown>
}) {
  return (to: string, m: MentionData) =>
    notifier.notify(to, "comment.mention", m, { idempotencyKey: m.key })
}
