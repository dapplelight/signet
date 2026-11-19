import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { type OverviewData, OverviewView, SAMPLE_OVERVIEW } from "./overview"

// Each state renders its own thing, and only that.
test.each<["loading" | "error" | "ready", OverviewData | undefined, string]>([
  ["loading", undefined, "Loading overview"],
  ["error", undefined, "The overview did not load."],
  ["ready", { stats: [], series: [], rows: [] }, "Nothing here yet"],
  ["ready", SAMPLE_OVERVIEW, "Recent activity"],
])("%s shows %#", (state, data, text) => {
  const html = renderToStaticMarkup(<OverviewView state={state} data={data} />)
  expect(html).toContain(text)
  for (const other of ["Loading overview", "did not load", "Nothing here yet", "Recent activity"])
    if (!text.includes(other)) expect(html).not.toContain(other)
})
