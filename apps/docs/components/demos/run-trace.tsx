"use client"

import {
  DecisionCallout,
  DecisionCalloutReason,
  DecisionCalloutTitle,
} from "@dapplelight/signet-ui/components/decision-callout"
import { StageRail } from "@dapplelight/signet-ui/components/stage-rail"
import {
  Timeline,
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "@dapplelight/signet-ui/components/timeline"

const stages = ["Plan", "Build", "Verify", "Review", "Ship"]

export function StageRailDemo() {
  return <StageRail aria-label="Run progress" stages={stages} current={2} className="max-w-md" />
}

export function RunTraceDemo() {
  return (
    <div className="w-full max-w-md space-y-6">
      <StageRail aria-label="Run progress" stages={stages} current={2} />
      <Timeline aria-label="Run trace">
        <TimelineItem status="complete">
          <TimelineMarker />
          <TimelineConnector />
          <TimelineTitle>Plan</TimelineTitle>
          <TimelineTime>09:02</TimelineTime>
          <TimelineDescription>Split the ticket into 4 tasks</TimelineDescription>
        </TimelineItem>
        <TimelineItem status="complete">
          <TimelineMarker />
          <TimelineConnector />
          <TimelineTitle>Build</TimelineTitle>
          <TimelineTime>09:14</TimelineTime>
          <TimelineDescription>Changed 7 files, +184 −36</TimelineDescription>
          <DecisionCallout>
            <DecisionCalloutTitle>
              Ran 42 affected tests instead of the full suite
            </DecisionCalloutTitle>
            <DecisionCalloutReason>
              The diff touches 3 of 61 packages; 18 s instead of 6 min.
            </DecisionCalloutReason>
          </DecisionCallout>
        </TimelineItem>
        <TimelineItem status="current">
          <TimelineMarker />
          <TimelineConnector />
          <TimelineTitle>Verify</TimelineTitle>
          <TimelineDescription>Running 42 tests</TimelineDescription>
        </TimelineItem>
        <TimelineItem status="upcoming">
          <TimelineMarker />
          <TimelineConnector />
          <TimelineTitle>Review</TimelineTitle>
        </TimelineItem>
        <TimelineItem status="upcoming">
          <TimelineMarker />
          <TimelineConnector />
          <TimelineTitle>Ship</TimelineTitle>
        </TimelineItem>
      </Timeline>
    </div>
  )
}
