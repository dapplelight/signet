import { ApiException } from "@dapplelight/signet-server/http"
import { zValidator } from "@dapplelight/signet-server/http/validate"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../app.ts"
import { NOTICE_VERSION, PURPOSES, type Services } from "../services.ts"

const purpose = z.object({ purpose: z.enum(PURPOSES.map((p) => p.id) as [string, ...string[]]) })

/**
 * DPDP consent and data requests for the signed-in user (signet-db privacy).
 * Fulfilling a request is a staff action: open it in /admin, or call
 * `privacy.fulfil(id, { actor })` from a job.
 *
 *   GET    /                    { purposes, consents, requests }
 *   POST   /consents/:purpose   give
 *   DELETE /consents/:purpose   withdraw, as easy as giving
 *   POST   /requests            { kind: "export" | "erasure" }
 */
export const privacyRoutes = (s: Services) =>
  new Hono<AppEnv>()
    .get("/", async (c) => {
      const id = c.get("user").id
      return c.json({
        purposes: PURPOSES,
        consents: await s.privacy.history(id),
        requests: await s.privacy.listRequests({ subject: id }),
      })
    })
    .post("/consents/:purpose", zValidator("param", purpose), async (c) => {
      const consent = await s.privacy.give(c.get("user").id, c.req.valid("param").purpose, {
        noticeVersion: NOTICE_VERSION,
        source: "settings",
      })
      return c.json({ consent })
    })
    .delete("/consents/:purpose", zValidator("param", purpose), async (c) => {
      await s.privacy.withdraw(c.get("user").id, c.req.valid("param").purpose)
      return c.json({ ok: true })
    })
    .post(
      "/requests",
      zValidator("json", z.object({ kind: z.enum(["export", "erasure"]) })),
      async (c) => {
        const id = c.get("user").id
        const request =
          c.req.valid("json").kind === "export"
            ? await s.privacy.requestExport(id)
            : await s.privacy.requestErasure(id)
        if (!request) throw new ApiException(500, "Could not open the request.", "INTERNAL")
        return c.json({ request }, 201)
      },
    )
