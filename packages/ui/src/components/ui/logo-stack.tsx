// An overlapping row of square project marks ("Acme", "Globex", then "+3"),
// built on Avatar: a real <img> with the initials as fallback. Each mark has a
// 2px ring in the page colour so neighbours separate. A mark that is dark on a
// dark page needs `lightTile`: it sets a light tile behind it, we never guess.
import type * as React from "react"

import { cn } from "../../lib/utils.js"
import { Avatar, AvatarFallback, AvatarImage, initials } from "./avatar.js"

type LogoStackSize = "sm" | "default" | "lg"

const markClass = "rounded-[5px] ring-2 ring-background"

interface LogoStackMarkData {
  /** Image URL of the mark. */
  src: string
  /** Name of the project. Read by screen readers; its initials show while the image loads or if it fails. */
  alt: string
  /** The mark is dark: put a light tile behind it on a dark page. Does nothing on a light page. */
  lightTile?: boolean
}

function LogoStackRoot({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="logo-stack"
      className={cn("flex w-fit items-center -space-x-2", className)}
      {...props}
    />
  )
}

function LogoStackMark({
  src,
  alt,
  lightTile,
  size,
  className,
  ...props
}: LogoStackMarkData &
  Omit<React.ComponentProps<typeof Avatar>, "children" | "size"> & { size?: LogoStackSize }) {
  return (
    <Avatar
      data-logo-mark=""
      data-light-tile={lightTile ? "true" : undefined}
      size={size}
      className={cn(markClass, lightTile && "dark:bg-white", className)}
      {...props}
    >
      <AvatarImage src={src} alt={alt} className="object-contain p-0.5" />
      <AvatarFallback className="text-[0.625rem]">{initials(alt)}</AvatarFallback>
    </Avatar>
  )
}

function LogoStackMore({
  count,
  size,
  className,
  children,
  ...props
}: { count: number; size?: LogoStackSize } & React.ComponentProps<"span">) {
  return (
    <span
      data-slot="logo-stack-more"
      role="img"
      aria-label={`${count} more`}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center bg-bg-elevated font-medium text-text-secondary tabular-nums",
        markClass,
        size === "sm"
          ? "size-6 text-[0.625rem]"
          : size === "lg"
            ? "size-10 text-sm"
            : "size-8 text-xs",
        className,
      )}
      {...props}
    >
      {children ?? `+${count}`}
    </span>
  )
}

interface LogoStackProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** The marks, in order. Later ones sit on top of earlier ones. */
  marks: LogoStackMarkData[]
  /** Most marks to show before the "+N" mark. Default 4. */
  max?: number
  /** 24px, 32px (default) or 40px marks. */
  size?: LogoStackSize
  /** Text for the "+N" mark's accessible name. Default `${n} more`. */
  moreLabel?: (count: number) => string
  /** Class per part. */
  classNames?: { mark?: string; more?: string }
}

function LogoStack({
  marks,
  max = 4,
  size,
  moreLabel,
  classNames,
  className,
  ...props
}: LogoStackProps) {
  const shown = marks.slice(0, max)
  const rest = marks.length - shown.length
  return (
    <LogoStackRoot className={className} {...props}>
      {shown.map((m, i) => (
        <LogoStackMark key={`${i}-${m.src}`} size={size} className={classNames?.mark} {...m} />
      ))}
      {rest > 0 && (
        <LogoStackMore
          count={rest}
          size={size}
          className={classNames?.more}
          aria-label={moreLabel?.(rest) ?? `${rest} more`}
        />
      )}
    </LogoStackRoot>
  )
}

export {
  LogoStack,
  LogoStackMark,
  type LogoStackMarkData,
  LogoStackMore,
  type LogoStackProps,
  LogoStackRoot,
  type LogoStackSize,
}
