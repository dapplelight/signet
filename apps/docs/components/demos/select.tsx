"use client"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@dapplelight/signet-ui/components/select"
import { useState } from "react"

export function SelectDemo() {
  return (
    <Select defaultValue="usd">
      <SelectTrigger className="w-48" aria-label="Currency">
        <SelectValue placeholder="Currency" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="usd">USD</SelectItem>
        <SelectItem value="eur">EUR</SelectItem>
        <SelectItem value="gbp">GBP</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function SelectGroupsDemo() {
  return (
    <Select>
      <SelectTrigger className="w-56" aria-label="Region">
        <SelectValue placeholder="Choose a region" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Americas</SelectLabel>
          <SelectItem value="us-east">US East</SelectItem>
          <SelectItem value="us-west">US West</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Europe</SelectLabel>
          <SelectItem value="eu-west">EU West</SelectItem>
          <SelectItem value="eu-central">EU Central</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function SelectControlledDemo() {
  const [status, setStatus] = useState<string | null>("pending")
  return (
    <div className="flex flex-col gap-2">
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-48" aria-label="Order status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="shipped">Shipped</SelectItem>
          <SelectItem value="delivered">Delivered</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-sm text-text-muted">Status: {status}</p>
    </div>
  )
}

export function SelectSmallDemo() {
  return (
    <Select defaultValue="30">
      <SelectTrigger size="sm" className="w-36" aria-label="Range">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="7">Last 7 days</SelectItem>
        <SelectItem value="30">Last 30 days</SelectItem>
        <SelectItem value="90">Last 90 days</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function SelectDisabledDemo() {
  return (
    <div className="flex gap-3">
      <Select disabled defaultValue="usd">
        <SelectTrigger className="w-40" aria-label="Currency">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="usd">USD</SelectItem>
        </SelectContent>
      </Select>
      <Select>
        <SelectTrigger className="w-40" aria-label="Plan" aria-invalid>
          <SelectValue placeholder="Plan (required)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="team">Team</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
