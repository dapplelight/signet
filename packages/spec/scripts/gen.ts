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
import {
  analyticsIngestRequestSchema,
  analyticsIngestResponseSchema,
  trackedEventSchema,
} from "../src/analytics"
import { ERROR_CODE_STATUS, errorEnvelopeSchema, SPEC_VERSION } from "../src/error"
import { webhookDeliverySchema } from "../src/webhooks"
import { authOpenApi } from "./auth-openapi"

const ROOT = join(import.meta.dirname, "..")
export const SCHEMAS_DIR = join(ROOT, "schemas")
export const OPENAPI_DIR = join(ROOT, "openapi")
export const PUBLIC_DIR = join(ROOT, "../../apps/docs/public/spec", SPEC_VERSION)
const BASE = `https://signet.dapplelight.in/spec/${SPEC_VERSION}`

/** A `<name>.schema.json` file from a Zod schema. */
function schemaFile(name: string, title: string, schema: z.ZodType): [string, object] {
  // io "input": these are wire shapes, so optional fields stay optional
  // and unknown keys are allowed rather than forbidden.
  const { $schema, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>
  const file = `${name}.schema.json`
  return [file, { $schema, $id: `${BASE}/${file}`, specVersion: SPEC_VERSION, title, ...rest }]
}

/** File name -> exact file contents. */
export function generate(): Record<string, string> {
  const files = Object.fromEntries([
    schemaFile("error-envelope", "Signet error envelope", errorEnvelopeSchema),
    schemaFile(
      "analytics-ingest-request",
      "Signet analytics ingest request",
      analyticsIngestRequestSchema,
    ),
    schemaFile(
      "analytics-ingest-response",
      "Signet analytics ingest response (202)",
      analyticsIngestResponseSchema,
    ),
    schemaFile("tracked-event", "Signet tracked event", trackedEventSchema),
    schemaFile("webhook-delivery", "Signet webhook delivery", webhookDeliverySchema),
  ]) as Record<string, object>
  files["error-codes.json"] = { specVersion: SPEC_VERSION, codes: ERROR_CODE_STATUS }
  return Object.fromEntries(
    Object.entries(files).map(([name, json]) => [name, `${JSON.stringify(json, null, 2)}\n`]),
  )
}

/** OpenAPI file name -> exact file contents; written to `openapi/` and to the docs site. */
export function generateOpenApi(): Record<string, string> {
  return { "auth.openapi.json": `${JSON.stringify(authOpenApi(), null, 2)}\n` }
}

if (import.meta.main) {
  const copies = [
    [SCHEMAS_DIR, generate()],
    [OPENAPI_DIR, generateOpenApi()],
    [PUBLIC_DIR, { ...generate(), ...generateOpenApi() }],
  ] as const
  for (const [dir, files] of copies) {
    mkdirSync(dir, { recursive: true })
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  }
  console.log(
    `spec ${SPEC_VERSION}: wrote ${[...Object.keys(generate()), ...Object.keys(generateOpenApi())].join(", ")}`,
  )
}
