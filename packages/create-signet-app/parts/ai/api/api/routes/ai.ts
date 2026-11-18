import { spendKey } from "@dapplelight/signet-db/ai-spend"
import { zValidator } from "@dapplelight/signet-server/http/validate"
import { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../app.ts"
import type { Services } from "../services.ts"

/**
 * AI routes. app.ts refuses any /api/ai call once the caller's or the app's
 * spend cap is reached (requireAiSpend, 429 with Retry-After); each call is
 * charged to the caller through `spendKey`. Copy this one for your own.
 *
 *   POST /summary   { text }   →   { summary, costUsd }
 */
export const aiRoutes = (s: Services) =>
  new Hono<AppEnv>().post(
    "/summary",
    zValidator("json", z.object({ text: z.string().min(1).max(10_000) })),
    async (c) => {
      const { value, meta } = await s.ai.extract({
        schema: z.object({ summary: z.string() }),
        instructions: "Summarise the text in one sentence.",
        input: c.req.valid("json").text,
        budget: { key: spendKey({ userId: c.get("user").id }) },
      })
      return c.json({ summary: value.summary, costUsd: meta.costUsd })
    },
  )
