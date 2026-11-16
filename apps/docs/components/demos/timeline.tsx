"use client"

import {
  Timeline,
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "@dapplelight/signet-ui/components/timeline"
import { PackageIcon, TruckIcon } from "lucide-react"

export function TimelineDemo() {
  return (
    <Timeline aria-label="Order history" className="max-w-sm">
      <TimelineItem status="complete">
        <TimelineMarker />
        <TimelineConnector />
        <TimelineTitle>Order placed</TimelineTitle>
        <TimelineTime>9:12 AM</TimelineTime>
        <TimelineDescription>Order #1042, 3 items.</TimelineDescription>
      </TimelineItem>
      <TimelineItem status="complete">
        <TimelineMarker />
        <TimelineConnector />
        <TimelineTitle>Payment received</TimelineTitle>
        <TimelineTime>9:14 AM</TimelineTime>
      </TimelineItem>
      <TimelineItem status="current">
        <TimelineMarker />
        <TimelineConnector />
        <TimelineTitle>Packed</TimelineTitle>
        <TimelineTime>Today, 11:30 AM</TimelineTime>
        <TimelineDescription>Leaves the warehouse this afternoon.</TimelineDescription>
      </TimelineItem>
      <TimelineItem status="upcoming">
        <TimelineMarker />
        <TimelineConnector />
        <TimelineTitle>Delivered</TimelineTitle>
        <TimelineTime>Expected tomorrow</TimelineTime>
      </TimelineItem>
    </Timeline>
  )
}

export function TimelinePlainDemo() {
  return (
    <Timeline aria-label="Order history" className="max-w-sm">
      <TimelineItem>
        <TimelineMarker />
        <TimelineConnector />
        <TimelineTitle>Account created</TimelineTitle>
        <TimelineTime>Jan 4</TimelineTime>
      </TimelineItem>
      <TimelineItem>
        <TimelineMarker />
        <TimelineConnector />
        <TimelineTitle>Plan upgraded to Pro</TimelineTitle>
        <TimelineTime>Mar 18</TimelineTime>
        <TimelineDescription>Billed annually.</TimelineDescription>
      </TimelineItem>
      <TimelineItem>
        <TimelineMarker />
        <TimelineConnector />
        <TimelineTitle>Invite sent to 4 teammates</TimelineTitle>
        <TimelineTime>Apr 2</TimelineTime>
      </TimelineItem>
    </Timeline>
  )
}

export function TimelineIconDemo() {
  return (
    <Timeline aria-label="Shipment" className="max-w-sm">
      <TimelineItem status="complete">
        <TimelineMarker>
          <PackageIcon />
        </TimelineMarker>
        <TimelineConnector />
        <TimelineTitle>Packed</TimelineTitle>
        <TimelineTime>Mon, 9:00 AM</TimelineTime>
      </TimelineItem>
      <TimelineItem status="current">
        <TimelineMarker>
          <TruckIcon />
        </TimelineMarker>
        <TimelineConnector />
        <TimelineTitle>Out for delivery</TimelineTitle>
        <TimelineTime>Tue, 8:15 AM</TimelineTime>
      </TimelineItem>
    </Timeline>
  )
}
