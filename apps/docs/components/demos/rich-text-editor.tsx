"use client"
import {
  RichTextContent,
  RichTextEditor,
  type RichTextPerson,
} from "@dapplelight/signet-ui/components/rich-text-editor"
import { useState } from "react"

const team: RichTextPerson[] = [
  { id: "u_1", name: "Priya Shah", email: "priya@acme.test" },
  { id: "u_2", name: "Marcus Lee", email: "marcus@acme.test" },
  { id: "u_3", name: "Dana Ortiz", email: "dana@acme.test" },
]

export function RichTextEditorDemo() {
  const [note, setNote] = useState("Follow up with **Acme Corp** about the renewal.")
  return (
    <div className="w-full max-w-lg">
      <RichTextEditor
        value={note}
        onValueChange={setNote}
        aria-label="Account note"
        placeholder="Write a note"
      />
    </div>
  )
}

export function RichTextEditorMentionsDemo() {
  return (
    <div className="w-full max-w-lg">
      <RichTextEditor
        aria-label="Comment"
        placeholder="Type @ to mention a teammate"
        onMentionSearch={(q) => team.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))}
      />
    </div>
  )
}

export function RichTextEditorFormatsDemo() {
  return (
    <div className="w-full max-w-lg">
      <RichTextEditor
        aria-label="Short reply"
        formats={["bold", "italic", "link"]}
        defaultValue="Thanks, the *refund* is on its way."
      />
    </div>
  )
}

export function RichTextEditorPreviewDemo() {
  const [value, setValue] = useState(
    "## Release notes\n\n- Faster **invoice** export\n- Fixed `null` totals",
  )
  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <RichTextEditor value={value} onValueChange={setValue} aria-label="Release notes" />
      <div className="rounded-lg border p-3">
        <RichTextContent value={value} />
      </div>
    </div>
  )
}

export function RichTextEditorDisabledDemo() {
  return (
    <div className="w-full max-w-lg">
      <RichTextEditor disabled aria-label="Archived note" defaultValue="This ticket is closed." />
    </div>
  )
}
