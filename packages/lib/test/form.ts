import { FormApi } from "@tanstack/react-form"
import { z } from "zod"
import { ApiError } from "../src/api/errors"
import {
  applyServerErrors,
  clearServerErrors,
  errorMessages,
  firstError,
  submitWithServerErrors,
} from "../src/form"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const schema = z.object({ email: z.string().email(), age: z.number().min(18) })
const makeForm = () => {
  const f = new FormApi({ defaultValues: { email: "", age: 0 }, validators: { onChange: schema } })
  f.mount()
  return f
}

// --- errorMessages: the real problem is mixed shapes ---
ok("empty -> []", errorMessages(undefined).length === 0 && errorMessages([]).length === 0)
ok("plain strings pass through", errorMessages(["boom"])[0] === "boom")
ok(
  "zod issue objects unwrapped",
  errorMessages([{ message: "Invalid email address", path: ["email"] }])[0] ===
    "Invalid email address",
)
ok("MIXED shapes both handled", errorMessages([{ message: "a" }, "b"]).join("|") === "a|b")
ok("nulls dropped", errorMessages([null, undefined, "x"]).length === 1)
ok("duplicates removed", errorMessages(["same", "same", { message: "same" }]).length === 1)
ok("objects with no message dropped", errorMessages([{ path: ["x"] }]).length === 0)
ok("firstError returns first", firstError([{ message: "one" }, "two"]) === "one")
ok("firstError undefined when empty", firstError([]) === undefined)

// the real-world case: raw zod output straight off a field
const f = makeForm()
f.setFieldValue("email", "nope")
f.validateSync("change")
const raw = f.getFieldMeta("email")?.errors
ok("raw zod errors render as objects without this", typeof raw?.[0] === "object")
ok(
  "errorMessages makes them printable",
  firstError(raw as never) === "Invalid email address",
  JSON.stringify(firstError(raw as never)),
)

// --- applyServerErrors ---
const f2 = makeForm()
const apiErr = new ApiError("Validation failed", 422, "VALIDATION_FAILED", {
  formErrors: ["Account already exists"],
  fieldErrors: { email: ["Already taken"], age: ["Must be an adult"] },
})
let banner: string[] = []
const formLevel = applyServerErrors(f2 as never, apiErr, {
  onFormError: (m) => {
    banner = m
  },
})
ok(
  "field error applied to email",
  firstError(f2.getFieldMeta("email")?.errors as never) !== undefined,
)
ok(
  "email carries the server message",
  errorMessages(f2.getFieldMeta("email")?.errors as never).includes("Already taken"),
)
ok(
  "second field also applied",
  errorMessages(f2.getFieldMeta("age")?.errors as never).includes("Must be an adult"),
)
ok("field marked touched so the error shows", f2.getFieldMeta("email")?.isTouched === true)
ok("form-level errors returned", formLevel[0] === "Account already exists")
ok("onFormError callback fired", banner[0] === "Account already exists")

// server key is separate, so re-validating does not strand a stale message
ok(
  "server error stored under its own key",
  Object.keys(f2.getFieldMeta("email")?.errorMap ?? {}).includes("onServer"),
)
clearServerErrors(f2 as never, ["email", "age"])
ok(
  "clearServerErrors removes it",
  !errorMessages(f2.getFieldMeta("email")?.errors as never).includes("Already taken"),
)

// non-validation errors become form-level, never thrown away
const f3 = makeForm()
const plain = applyServerErrors(f3 as never, new ApiError("Server exploded", 500))
ok("500 becomes a form-level message", plain[0] === "Server exploded")
const weird = applyServerErrors(f3 as never, new Error("network down"))
ok("non-ApiError still surfaces", weird[0] === "network down")

// a server error for a field the form has never registered must not blow up
// the whole call and take the valid fields' errors with it
const f6 = makeForm()
let threw = false
try {
  applyServerErrors(
    f6 as never,
    new ApiError("v", 422, "VALIDATION_FAILED", {
      formErrors: [],
      fieldErrors: { email: ["Taken"], neverRendered: ["Unknown field"] },
    }),
  )
} catch {
  threw = true
}
ok("unregistered field does not throw", !threw)
ok(
  "registered field still gets its error despite the unknown one",
  errorMessages(f6.getFieldMeta("email")?.errors as never).includes("Taken"),
)

// --- submitWithServerErrors ---
const f4 = makeForm()
const handler = submitWithServerErrors(
  () => f4 as never,
  async () => {
    throw apiErr
  },
)
ok("swallows ApiError and applies fields", (await handler({ value: {} })) === undefined)
ok(
  "fields populated by the wrapper",
  errorMessages(f4.getFieldMeta("email")?.errors as never).includes("Already taken"),
)

const f5 = makeForm()
let rethrown = false
try {
  await submitWithServerErrors(
    () => f5 as never,
    async () => {
      throw new TypeError("offline")
    },
  )({ value: {} })
} catch {
  rethrown = true
}
ok("RETHROWS non-ApiError (a network failure is not a validation result)", rethrown)

const okResult = await submitWithServerErrors(
  () => f5 as never,
  async () => "created",
)({ value: {} })
ok("passes through a successful result", okResult === "created")

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
