import { Search } from "lucide-react"
import { forwardRef, type InputHTMLAttributes } from "react"
import { cn } from "../../lib/utils.js"

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  containerClassName?: string
}

const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, containerClassName, ...props }, ref) => {
    return (
      <div
        className={cn(
          "flex h-8 items-center gap-2 rounded-lg border border-border-default bg-bg-elevated px-3",
          containerClassName,
        )}
      >
        <Search className="size-3.5 shrink-0 text-text-muted" />
        <input
          ref={ref}
          type="text"
          className={cn(
            "flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted",
            className,
          )}
          {...props}
        />
      </div>
    )
  },
)
SearchInput.displayName = "SearchInput"

export { SearchInput }
