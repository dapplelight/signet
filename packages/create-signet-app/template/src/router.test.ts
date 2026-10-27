import { expect, test } from "bun:test"
import { createMemoryHistory } from "@tanstack/react-router"
import { createAppRouter } from "./router"

// "/login" is where main.tsx sends a 401. If that route goes, the redirect
// lands on a not-found page, so it is checked here, not assumed.
test.each(["/", "/login"])("%s resolves to its own route", async (path) => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  await router.load()
  expect(router.state.matches.at(-1)?.routeId).toBe(path)
})
