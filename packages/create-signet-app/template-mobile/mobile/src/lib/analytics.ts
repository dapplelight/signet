import { beaconTransport, createAnalytics } from "@dapplelight/signet-lib/analytics"
import { usePathname } from "expo-router"
import { useEffect } from "react"
import { ANALYTICS_URL } from "./config"

/**
 * Events in batches to EXPO_PUBLIC_ANALYTICS_URL; with it unset, a client that
 * sends nothing. Ids live in memory, so each cold start is a new visit.
 */
export const analytics = createAnalytics(
  ANALYTICS_URL ? { transport: beaconTransport(ANALYTICS_URL) } : {},
)

/** One `screen_view` per route the app shows. Mounted once, in the root layout. */
export function useScreenViews() {
  const path = usePathname()
  useEffect(() => {
    analytics.track("screen_view", { path })
  }, [path])
}
