"use client"
import {
  ApprovalInboxCard,
  type WorkflowApprovalView,
  WorkflowRunTimeline,
  waitingText,
} from "@dapplelight/signet-ui/screens/workflow-screens"
import { useState } from "react"

export function WorkflowRunTimelineDemo() {
  return (
    <WorkflowRunTimeline
      className="w-full max-w-xl"
      run={{
        id: "run_9d1",
        workflow: "refund-order",
        status: "waiting",
        createdAt: "2026-11-16T09:00:00Z",
        waitingOn: {
          step: "manager-approval",
          kind: "approval",
          until: "2026-11-17T09:00:00Z",
          approvers: ["asha@example.com"],
        },
      }}
      steps={[
        {
          stepId: "validate-order",
          kind: "run",
          status: "completed",
          startedAt: "2026-11-16T09:00:00Z",
          finishedAt: "2026-11-16T09:00:02Z",
          summary: "Order 1042 found",
        },
        {
          stepId: "charge-reversal",
          kind: "run",
          status: "retrying",
          attempts: 2,
          error: "Gateway timeout",
          wakeAt: "2026-11-16T09:05:00Z",
          startedAt: "2026-11-16T09:00:03Z",
        },
        {
          stepId: "manager-approval",
          kind: "approval",
          status: "waiting",
          approvers: ["asha@example.com"],
          startedAt: "2026-11-16T09:01:00Z",
        },
      ]}
      onCancel={() => undefined}
    />
  )
}

export function ApprovalInboxCardDemo() {
  const [approvals, setApprovals] = useState<WorkflowApprovalView[]>([
    {
      runId: "run_9d1",
      stepId: "manager-approval",
      workflow: "refund-order",
      summary: "Refund $240.00 for order 1042",
      approvers: ["asha@example.com"],
      requestedAt: "2026-11-16T09:01:00Z",
    },
    {
      runId: "run_9d4",
      stepId: "discount-approval",
      workflow: "custom-discount",
      summary: "30% discount for Northwind Studio",
      approvers: ["asha@example.com"],
      requestedAt: "2026-11-16T10:20:00Z",
    },
  ])
  const decide = (a: WorkflowApprovalView) =>
    setApprovals((l) => l.filter((x) => x.runId !== a.runId))
  return (
    <ApprovalInboxCard
      className="w-full max-w-xl"
      approvals={approvals}
      onApprove={decide}
      onReject={decide}
    />
  )
}

export function WaitingTextDemo() {
  const text = waitingText({
    id: "run_9d1",
    workflow: "refund-order",
    status: "waiting",
    createdAt: "2026-11-16T09:00:00Z",
    waitingOn: {
      step: "manager-approval",
      kind: "approval",
      until: "2026-11-17T09:00:00Z",
      approvers: ["Asha Rao"],
    },
  })
  return <p className="text-sm text-text-secondary">{text}</p>
}
