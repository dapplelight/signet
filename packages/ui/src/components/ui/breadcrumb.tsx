// A breadcrumb trail: a nav landmark around an ordered list, with
// aria-current="page" on the last crumb. No behaviour beyond HTML is needed.
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"
import type * as React from "react"
import { cloneElement } from "react"
import { cn } from "../../lib/utils.js"

function Breadcrumb({ "aria-label": label = "Breadcrumb", ...props }: React.ComponentProps<"nav">) {
  return <nav aria-label={label} data-slot="breadcrumb" {...props} />
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-sm break-words text-text-muted",
        className,
      )}
      {...props}
    />
  )
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    />
  )
}

/** A crumb that links. Pass `render` to use the router's link element. */
function BreadcrumbLink({
  className,
  render,
  ...props
}: React.ComponentProps<"a"> & { render?: React.ReactElement<React.ComponentProps<"a">> }) {
  const merged = {
    "data-slot": "breadcrumb-link",
    className: cn(
      "rounded-sm transition-colors outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring",
      className,
    ),
    ...props,
  }
  if (render) {
    return cloneElement(render, {
      ...merged,
      className: cn(merged.className, render.props.className),
    } as React.ComponentProps<"a">)
  }
  return <a {...merged} />
}

/** The current page. Not a link. */
function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      aria-current="page"
      className={cn("font-normal text-text-primary", className)}
      {...props}
    />
  )
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  )
}

/** Stands in for crumbs left out of a long trail. */
function BreadcrumbEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      className={cn("flex size-5 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon aria-hidden="true" className="size-4" />
      <span className="sr-only">More</span>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
}
