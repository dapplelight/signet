/** labels: English by default, LabelsProvider swaps the words, nested providers merge. */
import { renderToStaticMarkup } from "react-dom/server"
import { DataTable } from "../src/components/ui/data-table"
import { ErrorState } from "../src/components/ui/error-state"
import { Pagination } from "../src/components/ui/pagination"
import { LabelsProvider } from "../src/lib/labels"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, String(d)))
}
const html = (el: React.ReactElement) => renderToStaticMarkup(el)
const pager = <Pagination page={2} totalPages={3} onPageChange={() => {}} />
const error = <ErrorState onRetry={() => {}} />

ok(
  "default: English",
  html(error).includes("Something went wrong") && html(error).includes("Try again"),
)
ok("default: aria labels", html(pager).includes('aria-label="Previous page"'))
{
  const out = html(
    <LabelsProvider labels={{ somethingWentWrong: "कुछ गड़बड़ हुई", previousPage: "पिछला पेज" }}>
      {error}
      {pager}
    </LabelsProvider>,
  )
  ok(
    "provider swaps text",
    out.includes("कुछ गड़बड़ हुई") && !out.includes("Something went wrong"),
    out,
  )
  ok("provider swaps aria labels", out.includes('aria-label="पिछला पेज"'), out)
  ok(
    "unset keys stay English",
    out.includes("Try again") && out.includes('aria-label="Next page"'),
    out,
  )
}
{
  const out = html(
    <LabelsProvider labels={{ tryAgain: "A" }}>
      <LabelsProvider labels={{ somethingWentWrong: "B" }}>{error}</LabelsProvider>
    </LabelsProvider>,
  )
  ok("nested providers merge", out.includes(">A<") && out.includes(">B<"), out)
}
{
  const table = (p: object) => (
    <DataTable columns={[{ accessorKey: "a", header: "A" }]} data={[]} {...p} />
  )
  ok(
    "table: empty text from labels",
    html(<LabelsProvider labels={{ noData: "Nada" }}>{table({})}</LabelsProvider>).includes("Nada"),
  )
  ok(
    "table: a prop still wins",
    html(
      <LabelsProvider labels={{ noData: "Nada" }}>{table({ emptyMessage: "Own" })}</LabelsProvider>,
    ).includes("Own"),
  )
  ok("table: default stays", html(table({})).includes("No data."))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
