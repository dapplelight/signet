"use client"

// An avatar on UI SDK's avatar behaviour: a real <img> that the browser can
// fetch before hydration, with a fallback shown until it loads or if it fails.
import {
  AvatarFallback as AvatarFallbackPrimitive,
  AvatarImage as AvatarImagePrimitive,
  Avatar as AvatarPrimitive,
} from "@ui-sdk/react/avatar"
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { cn } from "../../lib/utils.js"

const avatarVariants = cva(
  "relative inline-flex shrink-0 overflow-hidden rounded-full bg-bg-elevated align-middle select-none",
  {
    variants: {
      size: {
        sm: "size-6 text-xs",
        default: "size-8 text-sm",
        lg: "size-10 text-base",
      },
    },
    defaultVariants: { size: "default" },
  },
)

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive> & VariantProps<typeof avatarVariants>) {
  return <AvatarPrimitive className={cn(avatarVariants({ size }), className)} {...props} />
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarImagePrimitive>) {
  return (
    <AvatarImagePrimitive
      className={cn("aspect-square size-full object-cover", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarFallbackPrimitive>) {
  return (
    <AvatarFallbackPrimitive
      className={cn(
        "flex size-full items-center justify-center font-medium text-text-secondary uppercase",
        className,
      )}
      {...props}
    />
  )
}

/** "Ada Lovelace" -> "AL", "grace" -> "G". At most two letters. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const pick = words.length > 1 ? [words[0], words[words.length - 1]] : words
  return pick.map((w) => Array.from(w as string)[0]?.toUpperCase() ?? "").join("")
}

export { Avatar, AvatarFallback, AvatarImage, avatarVariants, initials }
