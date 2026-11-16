"use client"

import { Button } from "@dapplelight/signet-ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@dapplelight/signet-ui/components/tooltip"
import { TrashIcon } from "lucide-react"

export function TooltipDemo() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover me</Button>
        </TooltipTrigger>
        <TooltipContent>Add to your cart</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function TooltipSideDemo() {
  return (
    <TooltipProvider>
      <div className="flex gap-2">
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <Tooltip key={side}>
            <TooltipTrigger asChild>
              <Button variant="outline" className="capitalize">
                {side}
              </Button>
            </TooltipTrigger>
            <TooltipContent side={side}>Shown on the {side}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}

export function TooltipIconDemo() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Delete invoice">
            <TrashIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete invoice</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function TooltipDelayDemo() {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Instant</Button>
        </TooltipTrigger>
        <TooltipContent>No delay</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
