// The page rich-text.spec.ts loads: signet-ui's RichTextEditor from source,
// bundled by `bun build` in the spec, with its value shown beside it.
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { RichTextEditor } from "../../../ui/src/components/ui/rich-text-editor"

const PEOPLE = [
  { id: "u1", name: "Asha Rao" },
  { id: "u2", name: "Dev Patel" },
]
const w = window as unknown as { __link?: string | null }

function App() {
  const [value, setValue] = useState("")
  return (
    <>
      <RichTextEditor
        aria-label="Note"
        value={value}
        onValueChange={setValue}
        onRequestLink={() => w.__link ?? null}
        onMentionSearch={(q) =>
          PEOPLE.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
        }
      />
      <pre id="value">{value}</pre>
    </>
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
