import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ERROR_CODES as LIB_ERROR_CODES } from "../../lib/src/api/codes"
import { STATUS_CODES } from "../../server/src/http/status-codes"
import { generate, PUBLIC_DIR, SCHEMAS_DIR } from "../scripts/gen"
import {
  ERROR_CODE_STATUS,
  ERROR_CODES,
  errorCodeSchema,
  errorEnvelopeSchema,
  SPEC_VERSION,
} from "../src/error"

const generated = generate()
const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8")

describe("committed files match the Zod source (run `bun run gen`)", () => {
  for (const [name, text] of Object.entries(generated)) {
    test(`schemas/${name}`, () => expect(read(SCHEMAS_DIR, name)).toBe(text))
    test(`apps/docs/public/spec/${SPEC_VERSION}/${name}`, () =>
      expect(read(PUBLIC_DIR, name)).toBe(text))
  }
})

test("the docs code table lists every code and status, in order", () => {
  const mdx = readFileSync(
    join(PUBLIC_DIR, "../../../content/docs/packages/spec/index.mdx"),
    "utf8",
  )
  const rows = [...mdx.matchAll(/^\| `(\w+)` \| (\d{3}) \|$/gm)].map(([, c, s]) => [c, Number(s)])
  expect(rows).toEqual(Object.entries(ERROR_CODE_STATUS))
})

describe("error-codes.json", () => {
  const file = JSON.parse(read(SCHEMAS_DIR, "error-codes.json")) as {
    specVersion: string
    codes: Record<string, number>
  }

  test("carries the spec version", () => expect(file.specVersion).toBe("v1"))

  test("has every code in lib's ERROR_CODES, in lib's order", () => {
    expect(Object.keys(file.codes)).toEqual([...LIB_ERROR_CODES])
    expect(ERROR_CODES).toEqual([...LIB_ERROR_CODES])
  })

  test("keeps the status server gives a bare HTTPException", () => {
    for (const [status, code] of Object.entries(STATUS_CODES))
      expect(file.codes[code]).toBe(Number(status))
  })

  test("every status is an HTTP error status", () => {
    for (const status of Object.values(ERROR_CODE_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(600)
    }
  })
})

describe("error-envelope.schema.json", () => {
  const schema = JSON.parse(read(SCHEMAS_DIR, "error-envelope.schema.json"))

  test("is JSON Schema 2020-12 and carries the spec version", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(schema.specVersion).toBe("v1")
  })

  test("requires success and error only", () =>
    expect(schema.required).toEqual(["success", "error"]))
})

describe("zod schemas", () => {
  test("envelope parses what errorHandler writes", () => {
    const body = {
      success: false as const,
      error: "Validation failed",
      code: "VALIDATION_FAILED",
      details: { formErrors: [], fieldErrors: { email: ["Required"] } },
      requestId: "r1",
    }
    expect(errorEnvelopeSchema.parse(body)).toEqual(body)
    expect(errorEnvelopeSchema.safeParse({ success: false, error: "x" }).success).toBe(true)
  })

  test("envelope rejects a success body and a missing message", () => {
    expect(errorEnvelopeSchema.safeParse({ success: true, error: "x" }).success).toBe(false)
    expect(errorEnvelopeSchema.safeParse({ success: false }).success).toBe(false)
  })

  test("code schema accepts the RFC 6750 spellings only as spelled", () => {
    expect(errorCodeSchema.safeParse("invalid_token").success).toBe(true)
    expect(errorCodeSchema.safeParse("INVALID_TOKEN").success).toBe(false)
  })
})
