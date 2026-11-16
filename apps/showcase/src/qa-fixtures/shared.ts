import type { ReactNode } from "react"
import type { QaId } from "../qa-items"

/** What every QA fixture group exports: id -> a render function with static, offline data. */
export type Fixtures = Partial<Record<QaId, () => ReactNode>>

/** The fixed clock for every fixture and for `Date` itself (qa.tsx freezes it). */
export const QA_NOW_ISO = "2026-01-15T10:00:00.000Z"
export const QA_NOW = Date.parse(QA_NOW_ISO)

/** An ISO time `minutes` before the fixed clock, so fixtures stay relative to it. */
export const minutesAgo = (minutes: number) => new Date(QA_NOW - minutes * 60_000).toISOString()
