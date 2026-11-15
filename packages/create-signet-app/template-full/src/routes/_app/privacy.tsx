import { ConsentList, DataRequests } from "@dapplelight/signet-ui/screens/privacy-screens"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { api } from "../../lib/api"

export const Route = createFileRoute("/_app/privacy")({
  component: Privacy,
})

// DPDP consent (withdrawing is one switch) and data export / erasure
// requests. Staff fulfil requests; see README, "Privacy requests".
function Privacy() {
  const qc = useQueryClient()
  const data = useQuery({
    queryKey: ["privacy"],
    queryFn: async () => (await api.privacy.$get()).json(),
  }).data
  const refresh = () => qc.invalidateQueries({ queryKey: ["privacy"] })
  if (!data) return null

  return (
    <div className="space-y-10">
      <ConsentList
        purposes={data.purposes}
        consents={data.consents}
        onGive={async (purpose) => {
          await api.privacy.consents[":purpose"].$post({ param: { purpose } })
          await refresh()
        }}
        onWithdraw={async (purpose) => {
          await api.privacy.consents[":purpose"].$delete({ param: { purpose } })
          await refresh()
        }}
      />
      <DataRequests
        requests={data.requests}
        onRequestExport={async () => {
          await api.privacy.requests.$post({ json: { kind: "export" } })
          await refresh()
        }}
        onRequestErasure={async () => {
          await api.privacy.requests.$post({ json: { kind: "erasure" } })
          await refresh()
        }}
      />
    </div>
  )
}
