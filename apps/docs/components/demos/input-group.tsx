"use client"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@dapplelight/signet-ui/components/input-group"
import { EyeIcon, EyeOffIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

export function InputGroupDemo() {
  return (
    <InputGroup className="max-w-sm">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search invoices" aria-label="Search invoices" />
    </InputGroup>
  )
}

export function InputGroupTextDemo() {
  return (
    <div className="grid w-full max-w-sm gap-3">
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="0.00" inputMode="decimal" aria-label="Amount" />
        <InputGroupAddon align="inline-end">
          <InputGroupText>USD</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="acme" aria-label="Subdomain" />
        <InputGroupAddon align="inline-end">
          <InputGroupText>.signet.app</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export function InputGroupButtonDemo() {
  const [show, setShow] = useState(false)
  return (
    <InputGroup className="max-w-sm">
      <InputGroupInput
        type={show ? "text" : "password"}
        defaultValue="hunter2-hunter2"
        aria-label="API secret"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={show ? "Hide secret" : "Show secret"}
          onClick={() => setShow((s) => !s)}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function InputGroupTextareaDemo() {
  return (
    <InputGroup className="max-w-sm">
      <InputGroupTextarea placeholder="Add a note to this invoice" aria-label="Invoice note" />
      <InputGroupAddon align="block-end">
        <InputGroupText>0 / 280</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  )
}
