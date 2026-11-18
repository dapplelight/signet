import {
  AcceptInvitePage,
  type AcceptInvitePageProps,
} from "@dapplelight/signet-ui/screens/org-screens"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ApiError, AuthError, api } from "../lib/api"

export const Route = createFileRoute("/invite/$token")({
  component: Invite,
})

type Reason = NonNullable<AcceptInvitePageProps["error"]>

// The invite link. Anyone can see what it is for; accepting needs a signed-in
// user, so a signed-out visitor goes to /login and comes back here.
function Invite() {
  const { token } = Route.useParams()
  const preview = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => (await api.orgs.invites[":token"].$get({ param: { token } })).json(),
    retry: false,
  })
  const here = `/invite/${encodeURIComponent(token)}`
  const status = preview.data?.status
  return (
    <AcceptInvitePage
      org={preview.data?.org}
      invite={{
        role: preview.data?.role ?? null,
        ...(preview.data ? { expiresAt: preview.data.expiresAt } : {}),
      }}
      {...(preview.isError
        ? { error: "not_found" as const }
        : status && status !== "pending"
          ? { error: (status === "accepted" ? "used" : status) as Reason }
          : {})}
      onAccept={async () => {
        try {
          await api.orgs.invites[":token"].accept.$post({ param: { token } })
          return { ok: true }
        } catch (e) {
          if (e instanceof AuthError) {
            window.location.assign(`/login?next=${encodeURIComponent(here)}`)
            return new Promise(() => {}) // the page is leaving
          }
          if (e instanceof ApiError && e.code?.startsWith("INVITE_"))
            return { ok: false, reason: e.code.slice(7).toLowerCase() as Reason }
          throw e
        }
      }}
      onAccepted={() => window.location.assign("/")}
    />
  )
}
