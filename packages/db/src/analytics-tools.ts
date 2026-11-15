/**
 * Read-only analytics tools for an agent, as plain MCP tool objects (see
 * `tool-kit.ts`):
 *
 *   list_events       event names and counts in a range
 *   query_analytics   count, uniques, series, breakdown, funnel, retention or trend
 *
 * Results are aggregates across every user, never user ids or props of one
 * person, so mount these on a staff or admin MCP server, not a per-user one.
 */

import type { AnalyticsStore, Bucket, Period } from "./analytics.js"
import { bad, obj, type PlainTool } from "./tool-kit.js"

export type AnalyticsToolsOptions = { store: AnalyticsStore }

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
const KINDS = ["count", "uniques", "series", "breakdown", "funnel", "retention", "trend"] as const

const time = (v: unknown, key: string): number | undefined => {
  if (v === undefined) return undefined
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN
  if (Number.isNaN(t)) throw bad(`${key} must be an ISO date or date-time.`)
  return t
}

export function analyticsTools({ store }: AnalyticsToolsOptions): PlainTool[] {
  const range = {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
  }
  return [
    {
      name: "list_events",
      description:
        "Which analytics events exist and how often each happened (default: the last 7 days). Use it to find event names before query_analytics.",
      annotations: READ,
      inputSchema: obj(range),
      run: async (i) => ({
        events: await store.events({ from: time(i.from, "from"), to: time(i.to, "to") }),
      }),
    },
    {
      name: "query_analytics",
      description:
        "Answer an analytics question. kind: count (events), uniques (people or sessions), series (per hour/day/week), breakdown (by a property), funnel (steps in order), retention (weekly or daily cohorts), trend (this period vs the one before). Times are ISO; the default range is the last 7 days.",
      annotations: READ,
      inputSchema: obj(
        {
          kind: { type: "string", enum: KINDS },
          event: { type: "string", minLength: 1 },
          ...range,
          where: {
            type: "object",
            additionalProperties: { type: ["string", "number", "boolean"] },
          },
          by: { type: "string", enum: ["person", "session"] },
          unique: { type: "boolean" },
          bucket: { type: "string", enum: ["hour", "day", "week"] },
          property: { type: "string" },
          steps: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 10 },
          withinHours: { type: "number", exclusiveMinimum: 0 },
          returnEvent: { type: "string" },
          periods: { type: "integer", minimum: 1, maximum: 52 },
          period: { type: "string", enum: ["day", "week", "month"] },
        },
        ["kind"],
      ),
      run: async (i) => {
        const f = {
          event: i.event as string | undefined,
          from: time(i.from, "from"),
          to: time(i.to, "to"),
          where: i.where as Record<string, string> | undefined,
        }
        // funnel and retention take no property filter, and funnel names its events in steps:
        // refuse rather than answer for everyone as if the filter applied.
        if ((i.kind === "funnel" || i.kind === "retention") && i.where !== undefined)
          throw bad(`where is not supported for ${i.kind}.`)
        if (i.kind === "funnel" && i.event !== undefined)
          throw bad("funnel takes steps, not event.")
        switch (i.kind) {
          case "count":
            return { count: await store.count(f) }
          case "uniques":
            return { uniques: await store.uniques({ ...f, by: i.by as "person" | "session" }) }
          case "series":
            return {
              series: await store.series({ ...f, bucket: i.bucket as Bucket, unique: !!i.unique }),
            }
          case "breakdown":
            return {
              breakdown: await store.breakdown({
                ...f,
                property: String(i.property ?? ""),
                unique: !!i.unique,
              }),
            }
          case "funnel":
            return {
              funnel: await store.funnel({
                ...f,
                steps: i.steps as string[],
                withinMs: typeof i.withinHours === "number" ? i.withinHours * 3_600_000 : undefined,
              }),
            }
          case "retention":
            return {
              cohorts: await store.retention({
                ...f,
                startEvent: String(i.event ?? ""),
                returnEvent: i.returnEvent as string | undefined,
                bucket: (i.bucket as "day" | "week" | undefined) ?? "week",
                periods: i.periods as number | undefined,
              }),
            }
          case "trend":
            return {
              trend: await store.trend({
                ...f,
                period: i.period as Period | undefined,
                unique: !!i.unique,
              }),
            }
          default:
            throw bad(`kind must be one of ${KINDS.join(", ")}.`)
        }
      },
    },
  ]
}
