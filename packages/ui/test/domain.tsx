/**
 * Domain components outside the barrel: JobRuns (and Upload, below).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { JobRuns } = await import("../src/components/domain/job-runs")
type JobRun = import("../src/components/domain/job-runs").JobRun
const { Upload } = await import("../src/components/domain/upload")
type UploadTransport = import("../src/components/domain/upload").UploadTransport

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (e) {
    ok(`${name} (threw: ${(e as Error).message.split("\n")[0]})`, false)
  } finally {
    cleanup()
  }
}

await t("JobRuns", async () => {
  const runs: JobRun[] = [
    {
      id: "r1",
      job: "send-receipt",
      state: "dead",
      attempt: 3,
      error: { code: "UPSTREAM", message: "mail down" },
    },
    {
      id: "r2",
      job: "import",
      state: "running",
      attempt: 1,
      progress: { done: 2, total: 5, note: "row 2" },
    },
    { id: "r3", job: "import", state: "done", attempt: 1 },
  ]
  const retried: string[] = []
  const cancelled: string[] = []
  render(
    <JobRuns
      runs={runs}
      onRetry={(r) => retried.push(r.id)}
      onCancel={(r) => cancelled.push(r.id)}
    />,
  )
  ok("status badges", screen.getByText("dead").getAttribute("data-slot") === "badge")
  ok("error shown", !!screen.getByText(/UPSTREAM: mail down/))
  ok("progress shown", !!screen.getByText("2/5 · row 2"))
  ok("retry only on dead", screen.getAllByRole("button", { name: /^Retry/ }).length === 1)
  ok("cancel only on unfinished", screen.getAllByRole("button", { name: /^Cancel/ }).length === 1)
  await userEvent.click(screen.getByRole("button", { name: "Retry send-receipt r1" }))
  await userEvent.click(screen.getByRole("button", { name: "Cancel import r2" }))
  ok("callbacks get the run", retried.join() === "r1" && cancelled.join() === "r2")
  cleanup()
  render(<JobRuns runs={[]} />)
  ok("empty message", !!screen.getByText("No job runs"))
})

await t("Upload", async () => {
  const targets: string[] = []
  const confirmed: string[] = []
  let failNext = true
  const transport: UploadTransport = async (file, target, onProgress) => {
    onProgress(0.5)
    if (file.name === "flaky.png" && failNext) {
      failNext = false
      throw new Error("Upload failed (500)")
    }
    onProgress(1)
    targets.push(`${target.method ?? "PUT"} ${target.url}`)
  }
  render(
    <Upload
      multiple
      accept={["image/png", "image/jpeg"]}
      maxBytes={1024}
      transport={transport}
      getTarget={async (f) => ({
        url: `https://s.example/${f.name}`,
        headers: { "Content-Type": f.type },
      })}
      onUploaded={(f) => void confirmed.push(f.name)}
    />,
  )
  ok("hint from props", !!screen.getByText("PNG, JPEG, up to 1 KB"))
  const input = screen.getByLabelText("Drop a file here or choose one") as HTMLInputElement
  ok(
    "accessible file input",
    input.type === "file" && input.getAttribute("aria-describedby") !== null,
  )
  const png = new File([new Uint8Array(10)], "a.png", { type: "image/png" })
  await userEvent.upload(input, png)
  await waitFor(() => screen.getByText("Uploaded"))
  ok(
    "uploaded and confirmed",
    targets[0] === "PUT https://s.example/a.png" && confirmed[0] === "a.png",
  )
  ok(
    "progress at 100",
    screen.getByRole("progressbar", { name: "Uploading a.png" }).getAttribute("aria-valuenow") ===
      "100",
  )

  const zone = screen.getByRole("region", { name: "Upload" })
  const big = new File([new Uint8Array(2048)], "big.png", { type: "image/png" })
  const pdf = new File([new Uint8Array(10)], "doc.pdf", { type: "application/pdf" })
  fireEvent.drop(zone, { dataTransfer: { files: [big, pdf] } })
  ok(
    "size and type rejected before upload",
    !!screen.getByText(/big.png: over 1 KB. doc.pdf: type not allowed/),
  )
  ok("nothing sent for rejected files", targets.length === 1)

  fireEvent.drop(zone, {
    dataTransfer: { files: [new File([new Uint8Array(5)], "flaky.png", { type: "image/png" })] },
  })
  await waitFor(() => screen.getByText("Upload failed (500)"))
  await userEvent.click(screen.getByRole("button", { name: "Retry flaky.png" }))
  await waitFor(
    () => screen.getAllByText("Uploaded").length === 2 || Promise.reject(new Error("not yet")),
  )
  ok("retry succeeds", confirmed.join() === "a.png,flaky.png", confirmed)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
