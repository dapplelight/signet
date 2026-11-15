import { defineConfig } from "drizzle-kit"

// `db:generate` diffs api/db/schema.ts against drizzle/ and writes the next
// migration there. Commit it; the API applies pending ones on start.
export default defineConfig({
  dialect: "sqlite",
  schema: "./api/db/schema.ts",
  out: "./drizzle",
})
