import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { cn } from "../../lib/utils.js"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3 [&>svg]:text-text-primary",
  {
    variants: {
      variant: {
        default: "border-border-default bg-bg-surface text-text-primary",
        destructive:
          "border-destructive/50 bg-accent-red/10 text-accent-red [&>svg]:text-accent-red",
        warning:
          "border-accent-amber/50 bg-accent-amber/10 text-accent-amber [&>svg]:text-accent-amber",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <h5 className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <div className={cn("text-[12px] [&_p]:leading-relaxed", className)} {...props} />
}

export { Alert, AlertDescription, AlertTitle }
