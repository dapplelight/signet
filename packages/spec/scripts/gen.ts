/**
 * Writes the committed spec files from the Zod source in src/error.ts, to
 * packages/spec/schemas/ and to the docs site's apps/docs/public/spec/v1/.
 *
 *   bun run gen
 *
 * The tests import `generate()` and fail when either copy has drifted.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { ERROR_CODE_STATUS, errorEnvelopeSchema, SPEC_VERSION } from "../src/error"

const ROOT = join(import.meta.dirname, "..")
export const SCHEMAS_DIR = join(ROOT, "schemas")
export const PUBLIC_DIR = join(ROOT, "../../apps/docs/public/spec", SPEC_VERSION)
const BASE = `https://signet.dapplelight.in/spec/${SPEC_VERSION}`

/** File name -> exact file contents. */
export function generate(): Record<string, string> {
  // io "input": the envelope is a wire shape, so optional fields stay optional
  // and unknown keys are allowed rather than forbidden.
  const { $schema, ...envelope } = z.toJSONSchema(errorEnvelopeSchema, {
    io: "input",
  }) as Record<string, unknown>
  const files = {
    "error-envelope.schema.json": {
      $schema,
      $id: `${BASE}/error-envelope.schema.json`,
      specVersion: SPEC_VERSION,
      title: "Signet error envelope",
      ...envelope,
    },
    "error-codes.json": { specVersion: SPEC_VERSION, codes: ERROR_CODE_STATUS },
  }
  return Object.fromEntries(
    Object.entries(files).map(([name, json]) => [name, `${JSON.stringify(json, null, 2)}\n`]),
  )
}

if (import.meta.main) {
  for (const dir of [SCHEMAS_DIR, PUBLIC_DIR]) {
    mkdirSync(dir, { recursive: true })
    for (const [name, text] of Object.entries(generate())) writeFileSync(join(dir, name), text)
  }
  console.log(`spec ${SPEC_VERSION}: wrote ${Object.keys(generate()).join(", ")}`)
}
