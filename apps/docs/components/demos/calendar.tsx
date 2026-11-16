"use client"
import { Calendar } from "@dapplelight/signet-ui/components/calendar"
import * as React from "react"
import type { DateRange } from "react-day-picker"

export function CalendarDemo() {
  const [date, setDate] = React.useState<Date | undefined>(new Date(2026, 10, 17))
  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      defaultMonth={new Date(2026, 10)}
      className="rounded-lg border"
    />
  )
}

export function CalendarRangeDemo() {
  const [range, setRange] = React.useState<DateRange | undefined>({
    from: new Date(2026, 10, 10),
    to: new Date(2026, 10, 18),
  })
  return (
    <Calendar
      mode="range"
      selected={range}
      onSelect={setRange}
      defaultMonth={new Date(2026, 10)}
      className="rounded-lg border"
    />
  )
}

export function CalendarDropdownDemo() {
  const [date, setDate] = React.useState<Date | undefined>(new Date(2026, 10, 17))
  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      captionLayout="dropdown"
      startMonth={new Date(2024, 0)}
      endMonth={new Date(2028, 11)}
      defaultMonth={new Date(2026, 10)}
      className="rounded-lg border"
    />
  )
}

export function CalendarDisabledDemo() {
  const [date, setDate] = React.useState<Date | undefined>()
  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      defaultMonth={new Date(2026, 10)}
      disabled={[{ dayOfWeek: [0, 6] }, { before: new Date(2026, 10, 17) }]}
      className="rounded-lg border"
    />
  )
}
