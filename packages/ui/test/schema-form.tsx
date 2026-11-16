/** SchemaForm in happy-dom: fields from a zod schema, labels wired, validation, server errors. */
import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { default: userEvent } = await import("@testing-library/user-event")
const { z } = await import("zod")
const { fieldConfig } = await import("@autoform/zod")
const { SchemaForm } = await import("../src/components/ui/schema-form")
const { LabelsProvider } = await import("../src/lib/labels")

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

const Expense = z.object({
  title: z.string().min(2),
  amount: z.number().positive(),
  note: z
    .string()
    .optional()
    .check(
      fieldConfig({ fieldType: "textarea", label: "Notes", description: "Shown on the receipt" }),
    ),
  paid: z.boolean().default(false),
})

await t("fields", async () => {
  render(<SchemaForm schema={Expense} onSubmit={() => {}} />)
  ok("text field labelled from its key", !!screen.getByLabelText(/Title/))
  ok(
    "number field is type=number",
    screen.getByLabelText(/Amount/).getAttribute("type") === "number",
  )
  ok("fieldConfig: textarea + label", screen.getByLabelText(/Notes/).tagName === "TEXTAREA")
  ok("fieldConfig: description shown", !!screen.getByText("Shown on the receipt"))
  ok("boolean is a switch", !!screen.getByRole("switch", { name: /Paid/ }))
  ok("required marked", screen.getByText(/Title/).textContent?.includes("*") === true)
  ok("submit button", !!screen.getByRole("button", { name: "Submit" }))
})

await t("submit", async () => {
  const got: unknown[] = []
  render(<SchemaForm schema={Expense} onSubmit={(v) => void got.push(v)} />)
  await userEvent.click(screen.getByRole("button", { name: "Submit" }))
  await waitFor(() => {
    if (!document.querySelector("[aria-invalid=true]")) throw new Error("no invalid field yet")
  })
  ok("invalid submit does not call onSubmit", got.length === 0, got)
  ok("title marked invalid", screen.getByLabelText(/Title/).getAttribute("aria-invalid") === "true")
  await userEvent.type(screen.getByLabelText(/Title/), "Lunch")
  await userEvent.type(screen.getByLabelText(/Amount/), "12.5")
  await userEvent.click(screen.getByRole("switch", { name: /Paid/ }))
  await userEvent.click(screen.getByRole("button", { name: "Submit" }))
  await waitFor(() => {
    if (!got.length)
      throw new Error(
        `not submitted: ${[...document.querySelectorAll("[aria-invalid=true]")].map((e) => `${e.getAttribute("name")}=${(e as HTMLInputElement).value}`).join(",")} | ${[...document.querySelectorAll("[data-slot=field-error],[role=alert]")].map((e) => e.textContent).join(";")}`,
      )
  })
  const v = got[0] as { title: string; amount: number; paid: boolean }
  ok(
    "valid submit sends typed values",
    v.title === "Lunch" && v.amount === 12.5 && v.paid === true,
    v,
  )
})

await t("server errors", async () => {
  let seen: unknown = null
  render(
    <SchemaForm
      schema={Expense}
      defaultValues={{ title: "Lunch", amount: 3 }}
      onSubmit={() => {
        throw new Error("taken")
      }}
      onSubmitError={(error, form) => {
        seen = error
        ;(form as { setFieldMeta: (f: string, u: (m: object) => object) => void }).setFieldMeta(
          "title",
          (m) => ({ ...m, errorMap: { onServer: "Already used" } }),
        )
      }}
    />,
  )
  await userEvent.click(screen.getByRole("button", { name: "Submit" }))
  await waitFor(() => {
    if (!seen) throw new Error("no error yet")
  })
  ok("onSubmitError gets the error", (seen as Error).message === "taken")
  await waitFor(() => screen.getByText("Already used"))
  ok("a server error shows under its field", !!screen.getByText("Already used"))
})

await t("labels", async () => {
  render(
    <LabelsProvider labels={{ submit: "Enviar" }}>
      <SchemaForm schema={Expense} onSubmit={() => {}} />
    </LabelsProvider>,
  )
  ok("submit text from LabelsProvider", !!screen.getByRole("button", { name: "Enviar" }))
})

await t("select", async () => {
  const S = z.object({ kind: z.enum(["food", "travel"]) })
  render(<SchemaForm schema={S} onSubmit={() => {}} submit={false} />)
  ok("enum is a select trigger, labelled", !!screen.getByRole("combobox", { name: /Kind/ }))
  ok("submit={false} hides the button", !screen.queryByRole("button", { name: "Submit" }))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
