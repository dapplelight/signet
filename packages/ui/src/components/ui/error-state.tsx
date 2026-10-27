interface ErrorStateProps {
  message?: string
  onRetry?: () => void
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-[15px] font-medium text-text-primary">Something went wrong</p>
      {message && <p className="mt-1 text-[13px] text-text-secondary">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg bg-primary/10 px-4 py-2 text-[13px] font-medium text-primary transition-colors hover:bg-primary/20"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export { ErrorState }
