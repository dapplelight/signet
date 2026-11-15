/**
 * An admin API over every table in ./schema.ts, from signet-db's
 * `defineAdmin` and signet-server's `adminRoutes`. Added by `signet add admin`.
 *
 * Deny by default: every call needs a signed-in session (./auth.ts) and a
 * role from `roleOf`, which returns none until you read it from your users
 * table. roles(): admin may do everything, staff all but delete, readonly
 * list and get.
 */

import { defineAdmin, roles } from "@dapplelight/signet-db/admin"
import type { ValidSession } from "@dapplelight/signet-server/auth/sessions"
import { adminRoutes as mountAdmin } from "@dapplelight/signet-server/http/admin"
import { Hono } from "hono"
import { requireAuth } from "./auth.ts"
import { dbFor, schema } from "./db.ts"

export const admin = defineAdmin(schema, { authorize: roles() })

/** The user's role: "admin", "staff" or "readonly". Undefined is refused. */
async function roleOf(_userId: string): Promise<string | undefined> {
  return undefined
}

/** GET / is the schema; /:table lists and creates; /:table/:id gets, updates and deletes. */
export const adminRoutes = () =>
  new Hono().use("*", requireAuth()).route(
    "/",
    mountAdmin(admin, {
      db: (c) => dbFor(c.env.DB),
      ctx: async (c) => {
        const { record } = c.get("session" as never) as ValidSession
        return { actor: { type: "user" as const, id: record.sub }, role: await roleOf(record.sub) }
      },
    }),
  )
