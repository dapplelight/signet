"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Input } from "@dapplelight/signet-ui/components/input"
import { Label } from "@dapplelight/signet-ui/components/label"
import { Popover, PopoverContent, PopoverTrigger } from "@dapplelight/signet-ui/components/popover"
import { useState } from "react"

export function PopoverDemo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Invoice limits</Button>
      </PopoverTrigger>
      <PopoverContent className="grid gap-3">
        <div className="grid gap-1">
          <h4 className="text-sm font-medium">Invoice limits</h4>
          <p className="text-sm text-text-muted">Set the amount that needs approval.</p>
        </div>
        <div className="grid grid-cols-3 items-center gap-2">
          <Label htmlFor="popover-limit">Limit</Label>
          <Input id="popover-limit" defaultValue="5000" className="col-span-2 h-8" />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function PopoverAlignDemo() {
  return (
    <div className="flex gap-3">
      {(["start", "center", "end"] as const).map((align) => (
        <Popover key={align}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              {align}
            </Button>
          </PopoverTrigger>
          <PopoverContent align={align} className="w-48 text-sm">
            Aligned to the {align} of the trigger.
          </PopoverContent>
        </Popover>
      ))}
    </div>
  )
}

export function PopoverControlledDemo() {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">Rename project</Button>
      </PopoverTrigger>
      <PopoverContent className="grid gap-3">
        <Input defaultValue="Q4 campaign" aria-label="Project name" />
        <Button size="sm" onClick={() => setOpen(false)}>
          Save
        </Button>
      </PopoverContent>
    </Popover>
  )
}
