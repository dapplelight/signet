/**
 * Experiment and status screens: the experiment list marks the selected one
 * and selects on click; the readout shows rates, lift and p-values, offers
 * start / stop / roll out by status and reports a failed action; the status
 * page shows the overall status, maintenance, components and incident updates.
 * The experiment form validates and submits JSON or offering values; the
 * pricing readout shows money per exposed user, trial conversion and an LTV
 * estimate with one-click rollout; the status admin toggles maintenance,
 * sets component statuses, opens incidents and appends updates.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor, within } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { ExperimentForm, ExperimentList, ExperimentResults, PricingExperimentResults } =
  await import("../src/components/screens/experiment-screens")
const { StatusAdmin, StatusPage } = await import("../src/components/screens/status-screens")

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

const EXP = {
  key: "onboarding-copy",
  description: "Shorter onboarding",
  status: "running" as const,
  variants: [
    { key: "control", weight: 50 },
    { key: "short", weight: 50, value: { steps: 3 } },
  ],
  goal: "signup",
}
const RESULTS = {
  goal: "signup",
  alpha: 0.05,
  control: "control",
  variants: [
    {
      key: "control",
      exposed: 200,
      converted: 20,
      rate: 0.1,
      lift: null,
      pValue: null,
      significant: false,
    },
    {
      key: "short",
      exposed: 200,
      converted: 60,
      rate: 0.3,
      lift: 2,
      pValue: 0.0000004,
      significant: true,
    },
  ],
}

await t("ExperimentList", async () => {
  const picked: string[] = []
  render(
    <ExperimentList
      experiments={[EXP, { ...EXP, key: "pricing", status: "draft" }]}
      selected="pricing"
      onSelect={(k) => picked.push(k)}
    />,
  )
  ok("statuses shown", !!screen.getByText("Running") && !!screen.getByText("Draft"))
  ok(
    "selected marked aria-current",
    screen.getByRole("button", { name: /pricing/ }).getAttribute("aria-current") === "true",
  )
  await userEvent.click(screen.getByRole("button", { name: /onboarding-copy/ }))
  ok("select calls back", picked[0] === "onboarding-copy", picked)
  cleanup()
  render(<ExperimentList experiments={[]} />)
  ok("empty state", !!screen.getByText("No experiments yet"))
})

await t("ExperimentResults: readout and actions while running", async () => {
  const calls: string[] = []
  render(
    <ExperimentResults
      experiment={EXP}
      results={RESULTS}
      onStart={() => calls.push("start")}
      onStop={() => calls.push("stop")}
      onRollout={(v) => calls.push(`rollout:${v}`)}
    />,
  )
  const row = document.querySelector("[data-variant=short]") as HTMLElement
  ok(
    "rate and lift",
    within(row).getByText("30.0%") !== null && within(row).getByText("+200.0%") !== null,
  )
  ok("tiny p-value shown as <0.001", !!within(row).getByText("<0.001"))
  ok("significant row marked", row.hasAttribute("data-significant"))
  ok(
    "control marked",
    !!within(document.querySelector("[data-variant=control]") as HTMLElement).getByText("Control"),
  )
  ok("no Start while running", !screen.queryByRole("button", { name: "Start" }))
  await userEvent.click(screen.getByRole("button", { name: "Stop" }))
  await userEvent.click(screen.getByRole("button", { name: "Roll out short" }))
  await waitFor(() =>
    ok("stop and rollout call back", calls.join() === "stop,rollout:short", calls),
  )
})

await t("ExperimentResults: draft, rolled out, no results, failure", async () => {
  const { rerender } = render(
    <ExperimentResults
      experiment={{ ...EXP, status: "draft" }}
      results={null}
      onStart={() => false}
      onRollout={() => {}}
    />,
  )
  ok(
    "draft offers Start, no rollout",
    !!screen.getByRole("button", { name: "Start" }) && !screen.queryByText("Roll out"),
  )
  ok("no results note", !!screen.getByText(/pass the analytics events table/))
  await userEvent.click(screen.getByRole("button", { name: "Start" }))
  await waitFor(() =>
    ok("false shows the failure", !!screen.getByText("Could not save. Try again.")),
  )
  rerender(
    <ExperimentResults
      experiment={{ ...EXP, status: "rolled_out", winner: "short" }}
      results={RESULTS}
      onStart={() => {}}
    />,
  )
  ok(
    "winner marked, no Start",
    (document.querySelector("[data-variant=short]") as HTMLElement).hasAttribute("data-winner") &&
      !screen.queryByRole("button", { name: /Start|Resume/ }),
  )
  rerender(<ExperimentResults experiment={{ ...EXP, status: "stopped" }} onStart={() => {}} />)
  ok("stopped offers Resume", !!screen.getByRole("button", { name: "Resume" }))
})

await t("StatusPage", () => {
  render(
    <StatusPage
      summary={{
        status: "partial_outage",
        components: [
          { key: "api", name: "API", status: "partial_outage" },
          { key: "web", name: "Website", description: "Marketing site", status: "operational" },
        ],
        incidents: [
          {
            id: "i1",
            title: "Slow sign-in",
            status: "identified",
            impact: "major",
            components: ["api"],
            updates: [
              { at: "2026-11-01T00:00:00Z", status: "investigating", message: "Looking into it" },
              { at: "2026-11-01T00:10:00Z", status: "identified", message: "Found the cause" },
            ],
            startedAt: "2026-11-01T00:00:00Z",
            resolvedAt: null,
          },
        ],
        maintenance: { on: true, message: "Upgrading the database", until: "2026-11-01T02:00:00Z" },
      }}
    />,
  )
  ok("overall status", !!screen.getByRole("status").textContent?.includes("Partial outage"))
  ok(
    "maintenance notice",
    !!screen.getByText("Upgrading the database") && !!screen.getByText(/Expected back by/),
  )
  ok(
    "components with status",
    document
      .querySelector("[data-slot=status-component][data-status=operational]")
      ?.textContent?.includes("Website") ?? false,
  )
  const inc = document.querySelector("[data-slot=status-incident]") as HTMLElement
  ok("incident component by name", !!within(inc).getByText("API"))
  const items = inc.querySelectorAll("[data-status]")
  ok(
    "updates newest first",
    items[0]?.getAttribute("data-status") === "identified",
    items[0]?.outerHTML,
  )
  cleanup()
  render(
    <StatusPage
      summary={{
        status: "operational",
        components: [],
        incidents: [],
        maintenance: { on: false, message: null, until: null },
      }}
    />,
  )
  ok(
    "all good, no incidents",
    !!screen.getByText("All systems operational") && !!screen.getByText(/No incidents/),
  )
})

await t("ExperimentForm: create with JSON values, validation first", async () => {
  const sent: unknown[] = []
  render(<ExperimentForm onSubmit={(input) => sent.push(input)} />)
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  ok(
    "empty key and goal are refused",
    sent.length === 0 && !!screen.getByText(/Name the goal event/),
  )
  ok(
    "invalid fields marked",
    screen.getByRole("textbox", { name: "Key" }).getAttribute("aria-invalid") === "true",
  )
  await userEvent.type(screen.getByRole("textbox", { name: "Key" }), "onboarding-copy")
  await userEvent.type(screen.getByRole("textbox", { name: /Goal event/ }), "signup")
  await userEvent.clear(screen.getByRole("spinbutton", { name: "Variant 2 weight" }))
  await userEvent.type(screen.getByRole("spinbutton", { name: "Variant 2 weight" }), "25")
  const value = screen.getByRole("textbox", { name: "Variant 2 value (JSON)" })
  await userEvent.click(value)
  await userEvent.paste("{bad")
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  ok("bad JSON refused", sent.length === 0 && !!screen.getByText("Not valid JSON."))
  await userEvent.clear(value)
  await userEvent.click(value)
  await userEvent.paste('{"steps":3}')
  await userEvent.click(screen.getByRole("textbox", { name: /Audience/ }))
  await userEvent.paste('{"plan":["free"]}')
  await userEvent.click(screen.getByRole("button", { name: "Add variant" }))
  await userEvent.click(screen.getByRole("button", { name: "Remove variant 3" }))
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    ok(
      "submits the parsed input",
      JSON.stringify(sent[0]) ===
        JSON.stringify({
          key: "onboarding-copy",
          description: null,
          goal: "signup",
          audience: { plan: ["free"] },
          variants: [
            { key: "control", weight: 50 },
            { key: "test", weight: 25, value: { steps: 3 } },
          ],
        }),
      sent[0],
    ),
  )
  ok("saved announced", !!screen.getByText("Saved."))
  ok(
    "two variants is the minimum",
    (screen.getByRole("button", { name: "Remove variant 1" }) as HTMLButtonElement).disabled,
  )
})

await t("ExperimentForm: offering picker, edit, locked once started", async () => {
  const sent: any[] = []
  const calls: string[] = []
  const draft = {
    key: "price-test",
    status: "draft" as const,
    goal: "subscribed",
    variants: [
      { key: "control", weight: 50 },
      { key: "annual", weight: 50, value: { offering: "annual-first", version: 2 } },
    ],
  }
  const { rerender } = render(
    <ExperimentForm
      experiment={draft}
      offerings={[{ key: "default" }, { key: "annual-first" }]}
      onSubmit={(input) => sent.push(input)}
      onStart={() => calls.push("start")}
    />,
  )
  const pick2 = screen.getByRole("combobox", { name: "Variant 2 offering" }) as HTMLSelectElement
  ok("existing offering value picked", pick2.value === "annual-first")
  ok(
    "pinned version shown",
    (screen.getByRole("spinbutton", { name: "Variant 2 offering version" }) as HTMLInputElement)
      .value === "2",
  )
  ok(
    "control serves the placement's own",
    (screen.getByRole("combobox", { name: "Variant 1 offering" }) as HTMLSelectElement).value ===
      "",
  )
  ok(
    "key is read-only when editing",
    (screen.getByRole("textbox", { name: "Key" }) as HTMLInputElement).readOnly,
  )
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Variant 1 offering" }),
    "default",
  )
  await userEvent.clear(screen.getByRole("spinbutton", { name: "Variant 2 offering version" }))
  await userEvent.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    ok(
      "offering values submitted",
      JSON.stringify(sent[0]?.variants) ===
        JSON.stringify([
          { key: "control", weight: 50, value: { offering: "default" } },
          { key: "annual", weight: 50, value: { offering: "annual-first" } },
        ]),
      sent[0],
    ),
  )
  await userEvent.click(screen.getByRole("button", { name: "Start" }))
  await waitFor(() => ok("start calls back", calls[0] === "start"))
  rerender(
    <ExperimentForm
      experiment={{ ...draft, status: "running" }}
      offerings={[{ key: "default" }]}
      onSubmit={() => {}}
      onStop={() => calls.push("stop")}
    />,
  )
  ok(
    "running: fields locked with a note",
    !!(
      screen.getByRole("textbox", { name: /Goal event/ }).closest("fieldset") as HTMLFieldSetElement
    )?.disabled && !!screen.getByText(/fixed once an experiment starts/),
  )
  await userEvent.click(screen.getByRole("button", { name: "Stop" }))
  await waitFor(() => ok("stop calls back", calls[1] === "stop", calls))
})

const PRICING = {
  placements: ["onboarding"],
  alpha: 0.05,
  control: "control",
  variants: [
    {
      ...RESULTS.variants[0],
      offering: null,
      trials: 0,
      trialConverted: 0,
      trialConversion: null,
      revenue: { INR: 199800 },
      revenuePerExposed: { INR: 999 },
      ltv: {
        estimate: true as const,
        perCurrency: { INR: 2997 },
        churn: 0.33,
        expectedPayments: 3,
      },
    },
    {
      ...RESULTS.variants[1],
      offering: { offering: "annual-first", version: 2 },
      trials: 10,
      trialConverted: 4,
      trialConversion: 0.4,
      revenue: { INR: 1599800 },
      revenuePerExposed: { INR: 7999 },
      approximate: true,
      ltv: null,
    },
  ],
}

await t("PricingExperimentResults: money, trials, LTV estimate, rollout", async () => {
  const calls: string[] = []
  const exp = {
    ...EXP,
    key: "price-test",
    variants: [
      { key: "control", weight: 50 },
      { key: "short", weight: 50, value: { offering: "annual-first", version: 2 } },
    ],
  }
  render(
    <PricingExperimentResults
      experiment={exp}
      readout={PRICING}
      onRollout={(v) => calls.push(v)}
    />,
  )
  const ctl = document.querySelector("[data-variant=control]") as HTMLElement
  const alt = document.querySelector("[data-variant=short]") as HTMLElement
  ok("placements named", !!screen.getByText("Running on onboarding"))
  ok("control serves the placement's own", !!within(ctl).getByText("The placement's own offering"))
  ok("variant offering and version", !!within(alt).getByText("annual-first v2"))
  ok(
    "revenue per exposed user in money",
    (alt.textContent ?? "").includes("79.99"),
    alt.textContent,
  )
  ok("trial conversion", !!within(alt).getByText("40.0%"))
  ok(
    "LTV marked as an estimate",
    (ctl.querySelector("[data-estimate]")?.textContent ?? "").startsWith("~") &&
      !!screen.getByText(/LTV is an estimate/),
  )
  ok("approximate revenue flagged", (alt.textContent ?? "").includes("*"))
  await userEvent.click(
    screen.getByRole("button", { name: "Make short's offering the placement's offering" }),
  )
  await waitFor(() => ok("rollout calls back with the variant", calls[0] === "short", calls))
  cleanup()
  render(
    <PricingExperimentResults
      experiment={exp}
      readout={{ ...PRICING, placements: [] }}
      onRollout={() => {}}
    />,
  )
  ok("no placement: no rollout", !screen.queryByRole("button", { name: /Roll out|Make/ }))
})

await t("StatusAdmin: maintenance, components, incidents", async () => {
  const calls: any[] = []
  const summary = {
    components: [
      { key: "api", name: "API", status: "operational" as const },
      { key: "web", name: "Website", status: "degraded" as const },
    ],
    incidents: [
      {
        id: "i1",
        title: "Slow sign-in",
        status: "identified",
        impact: "major",
        components: ["api"],
        updates: [{ at: "2026-11-01T00:00:00Z", status: "identified", message: "Found it" }],
        startedAt: "2026-11-01T00:00:00Z",
        resolvedAt: null,
      },
      {
        id: "i0",
        title: "Old outage",
        status: "resolved",
        impact: "minor",
        components: [],
        updates: [{ at: "2026-10-01T00:00:00Z", status: "resolved", message: "Fixed" }],
        startedAt: "2026-10-01T00:00:00Z",
        resolvedAt: "2026-10-01T01:00:00Z",
      },
    ],
    maintenance: { on: false, message: null, until: null },
  }
  render(
    <StatusAdmin
      summary={summary}
      onMaintenance={(m) => calls.push(["maintenance", m])}
      onComponentStatus={(k, s) => calls.push(["component", k, s])}
      onOpenIncident={(i) => calls.push(["open", i])}
      onUpdateIncident={(id, u) => calls.push(["update", id, u])}
    />,
  )
  await userEvent.click(screen.getByRole("switch", { name: "Maintenance mode" }))
  const mform = document.querySelector("[data-slot=maintenance-form]") as HTMLElement
  await userEvent.type(within(mform).getByRole("textbox", { name: "Message" }), "Upgrading")
  const until = document.querySelector("input[type=datetime-local]") as HTMLInputElement
  await userEvent.type(until, "2026-11-20T10:30")
  await userEvent.click(within(mform).getByRole("button", { name: "Save" }))
  await waitFor(() => {
    const m = calls.find((c) => c[0] === "maintenance")?.[1]
    ok(
      "maintenance on with message and until",
      m?.on === true &&
        m.message === "Upgrading" &&
        m.until === new Date("2026-11-20T10:30").toISOString(),
      m,
    )
  })
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "API status" }),
    "major_outage",
  )
  await waitFor(() =>
    ok(
      "component status saves on change",
      JSON.stringify(calls.find((c) => c[0] === "component")) ===
        JSON.stringify(["component", "api", "major_outage"]),
    ),
  )
  const form = document.querySelector("[data-slot=incident-form]") as HTMLElement
  ok(
    "open needs title and message",
    (within(form).getByRole("button", { name: "Open incident" }) as HTMLButtonElement).disabled,
  )
  await userEvent.type(within(form).getByRole("textbox", { name: "Title" }), "API errors")
  await userEvent.selectOptions(within(form).getByRole("combobox", { name: "Impact" }), "critical")
  await userEvent.click(within(form).getByRole("checkbox", { name: "API" }))
  await userEvent.type(within(form).getByRole("textbox", { name: "Message" }), "Looking into it")
  await userEvent.click(within(form).getByRole("button", { name: "Open incident" }))
  await waitFor(() =>
    ok(
      "incident opened",
      JSON.stringify(calls.find((c) => c[0] === "open")?.[1]) ===
        JSON.stringify({
          title: "API errors",
          impact: "critical",
          status: "investigating",
          components: ["api"],
          message: "Looking into it",
        }),
      calls,
    ),
  )
  ok(
    "form clears after opening",
    (within(form).getByRole("textbox", { name: "Title" }) as HTMLInputElement).value === "",
  )
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "New status for Slow sign-in" }),
    "monitoring",
  )
  await userEvent.type(
    screen.getByRole("textbox", { name: "Update for Slow sign-in" }),
    "Fix deployed",
  )
  await userEvent.click(screen.getByRole("button", { name: "Post update" }))
  await waitFor(() =>
    ok(
      "update appended",
      JSON.stringify(calls.find((c) => c[0] === "update")) ===
        JSON.stringify(["update", "i1", { status: "monitoring", message: "Fix deployed" }]),
      calls,
    ),
  )
  await userEvent.type(
    screen.getByRole("textbox", { name: "Update for Slow sign-in" }),
    "All clear",
  )
  await userEvent.click(screen.getByRole("button", { name: "Resolve" }))
  await waitFor(() =>
    ok(
      "resolve posts a resolved update",
      JSON.stringify(calls.filter((c) => c[0] === "update")[1]) ===
        JSON.stringify(["update", "i1", { status: "resolved", message: "All clear" }]),
      calls,
    ),
  )
  const old = document.querySelector(
    "[data-slot=incident-update-form][data-resolved]",
  ) as HTMLElement
  ok(
    "a resolved incident has no update form",
    !within(old).queryByRole("button", { name: "Post update" }) &&
      !!within(old).getByText(/cannot change/),
  )
  ok("no edit or delete of updates", !screen.queryByRole("button", { name: /Edit|Delete/ }))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
