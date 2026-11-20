import { createRelativeTimeFormatter } from "@dapplelight/signet-lib/format"
import { useQuery } from "@tanstack/react-query"
import { api, type Device } from "./api"

export const relative = createRelativeTimeFormatter()

/** Where this account is signed in: the sample list. Current device first. */
export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { sessions } = await api.get<{ sessions: Device[] }>("/api/sessions")
      return sessions.sort(
        (a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt,
      )
    },
  })
}
