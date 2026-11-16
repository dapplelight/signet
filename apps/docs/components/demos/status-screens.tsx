"use client"
import {
  ComponentStatusList,
  IncidentForm,
  IncidentUpdateForm,
  MaintenanceForm,
  StatusAdmin,
  StatusPage,
  type StatusSummaryView,
} from "@dapplelight/signet-ui/screens/status-screens"

const summary: StatusSummaryView = {
  status: "degraded",
  maintenance: { on: false, message: null, until: null },
  components: [
    { key: "api", name: "API", description: "REST and RPC endpoints", status: "operational" },
    { key: "dashboard", name: "Dashboard", status: "degraded" },
    { key: "payments", name: "Payments", status: "operational" },
  ],
  incidents: [
    {
      id: "inc1",
      title: "Slow dashboard loads",
      status: "monitoring",
      impact: "minor",
      components: ["dashboard"],
      startedAt: "2026-11-16T09:10:00Z",
      resolvedAt: null,
      updates: [
        {
          at: "2026-11-16T09:40:00Z",
          status: "monitoring",
          message: "A fix is deployed. We are watching load times.",
        },
        {
          at: "2026-11-16T09:10:00Z",
          status: "investigating",
          message: "Some users see slow dashboard loads.",
        },
      ],
    },
  ],
}

export function StatusPageDemo() {
  return <StatusPage className="w-full max-w-2xl" summary={summary} />
}

export function StatusPageMaintenanceDemo() {
  return (
    <StatusPage
      className="w-full max-w-2xl"
      summary={{
        ...summary,
        status: "maintenance",
        incidents: [],
        maintenance: {
          on: true,
          message: "Database upgrade in progress.",
          until: "2026-11-20T06:00:00Z",
        },
      }}
    />
  )
}

export function StatusAdminDemo() {
  return (
    <StatusAdmin
      className="w-full max-w-3xl"
      summary={summary}
      onMaintenance={() => undefined}
      onComponentStatus={() => undefined}
      onOpenIncident={() => undefined}
      onUpdateIncident={() => undefined}
    />
  )
}

export function MaintenanceFormDemo() {
  return (
    <MaintenanceForm
      className="w-full max-w-md"
      maintenance={{ on: false, message: "Database upgrade", until: null }}
      onSave={() => undefined}
    />
  )
}

export function ComponentStatusListDemo() {
  return (
    <ComponentStatusList
      className="w-full max-w-md"
      components={summary.components}
      onStatus={() => undefined}
    />
  )
}

export function IncidentFormDemo() {
  return (
    <IncidentForm
      className="w-full max-w-md"
      components={summary.components}
      onOpen={() => undefined}
    />
  )
}

export function IncidentUpdateFormDemo() {
  return (
    <IncidentUpdateForm
      className="w-full max-w-md"
      incident={summary.incidents[0]}
      onUpdate={() => undefined}
    />
  )
}
