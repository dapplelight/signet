/**
 * Type-level regression test. Run with `tsc --noEmit`; it has no runtime
 * assertions and is not expected to be executed.
 *
 * The bug this exists for: `ExtractArgs` typed `schema: z.ZodType<T>` with `T`
 * on the function. Under zod 4 that does not infer from a concrete schema — `T`
 * collapsed to `unknown`, so `value` was `unknown` and every field access was a
 * type error. The first production consumer had to write
 * `ai.extract<Gap>({ schema: gapSchema })` to work around it.
 *
 * No internal test caught it, because they all annotate the expected type
 * first. Only using the INFERRED value exposes it — which is what this does.
 */

import { z } from "zod"
import { createExtractor } from "../src/extract"
import { fakeProvider } from "../src/fake"

const schema = z.object({
  maxPrice: z.number(),
  category: z.string(),
  inStock: z.boolean(),
  tags: z.array(z.string()),
})

const ai = createExtractor({ providers: [fakeProvider({})] })

async function inferenceCompiles() {
  // Deliberately NO explicit type argument.
  const { value, meta } = await ai.extract({
    schema,
    input: "8000 se kam ka snowboard",
    instructions: "extract",
  })

  const price: number = value.maxPrice
  const category: string = value.category
  const inStock: boolean = value.inStock
  const tags: string[] = value.tags
  const provider: string = meta.provider
  const cost: number = meta.costUsd

  // @ts-expect-error — a field not in the schema must NOT type-check.
  void value.notAField

  return { price, category, inStock, tags, provider, cost }
}

async function fallbackIsTyped() {
  const { value } = await ai.extract({
    schema,
    input: "x",
    instructions: "y",
    // The fallback must accept the inferred shape, not `unknown`.
    fallback: { value: { maxPrice: 0, category: "", inStock: false, tags: [] } },
  })
  const n: number = value.maxPrice
  return n
}

void inferenceCompiles
void fallbackIsTyped
