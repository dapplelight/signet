import {
  ApiKeysManager,
  ProfileCard,
  SessionsList,
} from "@dapplelight/signet-ui/screens/account-screens"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { api, meQuery } from "../../lib/api"

export const Route = createFileRoute("/_app/account")({
  component: Account,
})

function Account() {
  const qc = useQueryClient()
  const me = useQuery(meQuery).data
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => (await api.sessions.$get()).json(),
  }).data
  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => (await api.account["api-keys"].$get()).json(),
  }).data
  const refresh = (key: string) => qc.invalidateQueries({ queryKey: [key] })

  return (
    <div className="space-y-8">
      {me ? (
        <ProfileCard
          profile={me.user}
          onSave={async ({ name }) => {
            await api.account.me.$patch({ json: { name } })
            await refresh("me")
          }}
        />
      ) : null}
      <SessionsList
        sessions={sessions?.sessions ?? []}
        onRevoke={async (s) => {
          await api.sessions[":id"].$delete({ param: { id: s.id } })
          if (s.current) window.location.assign("/login")
          else await refresh("sessions")
        }}
        onRevokeOthers={async () => {
          await api.sessions["revoke-others"].$post()
          await refresh("sessions")
        }}
      />
      <ApiKeysManager
        keys={keys?.keys ?? []}
        onCreate={async ({ name }) => {
          const { token } = await (await api.account["api-keys"].$post({ json: { name } })).json()
          await refresh("api-keys")
          return { token }
        }}
        onRevoke={async (k) => {
          await api.account["api-keys"][":id"].$delete({ param: { id: k.id } })
          await refresh("api-keys")
        }}
      />
    </div>
  )
}
