import { ChevronLeft, ChevronRight } from "lucide-react"
import { useLabels } from "../../lib/labels.js"
import { cn } from "../../lib/utils.js"

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  const l = useLabels()
  if (totalPages <= 1) return null

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="flex size-7 items-center justify-center rounded-md bg-bg-elevated text-text-muted transition-colors hover:bg-bg-elevated/80 disabled:opacity-40"
        aria-label={l.previousPage}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="flex size-7 items-center justify-center rounded-md bg-primary/12 text-[11px] font-medium text-primary">
        {page}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="flex size-7 items-center justify-center rounded-md bg-bg-elevated text-text-muted transition-colors hover:bg-bg-elevated/80 disabled:opacity-40"
        aria-label={l.nextPage}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  )
}

export { Pagination }
