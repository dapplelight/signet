import { ApprovalInboxCard } from "@dapplelight/signet-ui/screens/workflow-screens"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { api } from "../../lib/api"

export const Route = createFileRoute("/_app/approvals")({
  component: Approvals,
})

// Workflow approval steps waiting on you (signet-db workflows, /api/workflows),
// each with Approve and Reject. The run carries on at the runner's next tick.
function Approvals() {
  const qc = useQueryClient()
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: async () => (await api.workflows.approvals.$get()).json(),
  }).data
  if (!approvals) return null
  const decide = (verb: "approve" | "reject") => async (a: { runId: string; stepId: string }) => {
    await api.workflows.runs[":id"].steps[":step"][verb].$post({
      param: { id: a.runId, step: a.stepId },
    })
    await qc.invalidateQueries({ queryKey: ["approvals"] })
  }

  return (
    <ApprovalInboxCard
      approvals={approvals}
      withReason={false}
      onApprove={decide("approve")}
      onReject={decide("reject")}
    />
  )
}
