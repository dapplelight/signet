import { expect, test } from "bun:test"
import { createMemoryHistory } from "@tanstack/react-router"
import { createAppRouter } from "./router"

// Every page resolves to its own route. "/login" is where main.tsx sends a
// 401, so losing it would land users on a not-found page.
test.each([
  ["/login", "/login"],
  ["/", "/_app/"],
  ["/account", "/_app/account"],
  ["/notifications", "/_app/notifications"],
  ["/privacy", "/_app/privacy"],
  ["/billing", "/_app/billing"],
  ["/admin", "/_app/admin"],
])("%s resolves to %s", async (path, id) => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  await router.load()
  expect(router.state.matches.at(-1)?.routeId).toBe(id as never)
})
