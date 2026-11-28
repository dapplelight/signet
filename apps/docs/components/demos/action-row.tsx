"use client"
import { ActionRow } from "@dapplelight/signet-ui/components/action-row"
import { Button } from "@dapplelight/signet-ui/components/button"
import { GitMergeIcon, MessageCircleQuestionIcon, RocketIcon } from "lucide-react"

export function ActionRowDemo() {
  return (
    <div className="w-full max-w-2xl">
      <ActionRow
        icon={<GitMergeIcon />}
        title="Merge PR #482"
        description="CI passed and two people approved. Merging adds 3 commits to main."
        actions={
          <>
            <Button variant="outline">View diff</Button>
            <Button>Merge</Button>
          </>
        }
      />
    </div>
  )
}

export function ActionRowAskDemo() {
  return (
    <div className="w-full max-w-2xl">
      <ActionRow
        tone="ask"
        icon={<MessageCircleQuestionIcon />}
        title="Which database should the new service use?"
        description="The agent paused the setup and is waiting for your pick."
        actions={
          <>
            <Button variant="outline">Postgres</Button>
            <Button>SQLite</Button>
          </>
        }
      />
    </div>
  )
}

export function ActionRowWarnDemo() {
  return (
    <div className="w-full max-w-2xl">
      <ActionRow
        tone="warn"
        icon={<RocketIcon />}
        title="Approve deploy to production"
        description="Build 9f3c2e1 failed one smoke test in staging. Approving ships it anyway."
        actions={
          <>
            <Button variant="outline">Reject</Button>
            <Button>Approve</Button>
          </>
        }
      />
    </div>
  )
}
