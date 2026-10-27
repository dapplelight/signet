import type * as React from "react"

interface EmptyStateProps {
  title: string
  description?: string
  action?: React.ReactNode
  icon?: React.ReactNode
}

function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      {icon && <div className="mb-4 text-text-hint">{icon}</div>}
      <p className="text-[15px] font-medium text-text-primary">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-[13px] text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export { EmptyState }
