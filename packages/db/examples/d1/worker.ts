/**
 * Cloudflare Worker on D1. Run with `wrangler dev` after
 * `wrangler d1 create app-db` and a `[[d1_databases]] binding = "DB"` entry
 * in wrangler.toml; apply migrations with `wrangler d1 migrations apply`.
 */
import { eq } from "drizzle-orm"
import type { AnyD1Database } from "drizzle-orm/d1"
import { createCipher, scoped } from "../../src"
import { createDb } from "../../src/d1"
import * as schema from "../schema"

type Bindings = { DB: AnyD1Database; FIELD_KEY: string }

export default {
  async fetch(req: Request, bindings: Bindings): Promise<Response> {
    // Config is built per request from bindings; Workers have no env at import time.
    const db = createDb(bindings.DB, {
      schema,
      cipher: createCipher({ keys: { k1: bindings.FIELD_KEY }, current: "k1" }),
    })
    const userId = req.headers.get("x-user-id") // use your session middleware here
    if (!userId) return new Response("unauthorised", { status: 401 })
    const me = scoped(db, { userId })
    const id = new URL(req.url).searchParams.get("id")
    return Response.json(
      id
        ? await me.select(schema.orders, eq(schema.orders.id, id))
        : await me.select(schema.orders),
    )
  },
}
