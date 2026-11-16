"use client"
import {
  ConsentList,
  type ConsentRecord,
  type DataRequestRow,
  DataRequests,
  PrivacySection,
} from "@dapplelight/signet-ui/screens/privacy-screens"
import { useState } from "react"

const purposes = [
  {
    id: "analytics",
    label: "Product analytics",
    description: "Helps us see which features are used.",
  },
  { id: "marketing", label: "Marketing emails", description: "News, offers and tips." },
  { id: "personalisation", label: "Personalised recommendations" },
]

export function ConsentListDemo() {
  const [consents, setConsents] = useState<ConsentRecord[]>([
    { purpose: "analytics", noticeVersion: "2026-09", givenAt: "2026-10-02T10:00:00Z" },
  ])
  return (
    <ConsentList
      className="w-full max-w-md"
      purposes={purposes}
      consents={consents}
      onGive={(purpose) =>
        setConsents((c) => [
          ...c,
          { purpose, noticeVersion: "2026-09", givenAt: new Date().toISOString() },
        ])
      }
      onWithdraw={(purpose) =>
        setConsents((c) =>
          c.map((r) =>
            r.purpose === purpose ? { ...r, withdrawnAt: new Date().toISOString() } : r,
          ),
        )
      }
    />
  )
}

export function DataRequestsDemo() {
  const [requests, setRequests] = useState<DataRequestRow[]>([
    {
      id: "r1",
      kind: "export",
      status: "completed",
      requestedAt: "2026-10-20T08:00:00Z",
      closedAt: "2026-10-21T08:00:00Z",
    },
  ])
  return (
    <DataRequests
      className="w-full max-w-md"
      requests={requests}
      onRequestExport={() =>
        setRequests((r) => [
          {
            id: `r${r.length + 1}`,
            kind: "export",
            status: "pending",
            requestedAt: new Date().toISOString(),
            dueAt: "2026-12-16",
          },
          ...r,
        ])
      }
      onRequestErasure={() => undefined}
      onDownload={() => undefined}
    />
  )
}

export function PrivacySectionDemo() {
  return (
    <PrivacySection className="w-full max-w-md">
      <h2 className="text-base font-medium">Data retention</h2>
      <p className="text-text-muted">We keep invoices for 8 years, as the law requires.</p>
    </PrivacySection>
  )
}
