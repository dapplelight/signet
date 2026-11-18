import { Button } from "@dapplelight/signet-ui/components/button"
import { Field, FieldControl, FieldLabel } from "@dapplelight/signet-ui/components/field"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { api, switchOrg } from "../../../lib/api"

export const Route = createFileRoute("/_app/org/new")({
  component: NewOrg,
})

// A new org with you as its owner; the app switches to it.
function NewOrg() {
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  return (
    <form
      className="max-w-sm space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        setPending(true)
        try {
          const { org } = await (await api.orgs.$post({ json: { name: name.trim() } })).json()
          await switchOrg(org.id, "/org")
        } finally {
          setPending(false)
        }
      }}
    >
      <h1 className="text-lg font-semibold">New organisation</h1>
      <Field>
        <FieldLabel>Name</FieldLabel>
        <FieldControl
          required
          maxLength={100}
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={pending || !name.trim()}>
        Create
      </Button>
    </form>
  )
}
