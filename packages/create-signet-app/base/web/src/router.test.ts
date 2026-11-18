import { expect, test } from "bun:test"
import { createMemoryHistory } from "@tanstack/react-router"
import { createAppRouter } from "./router"

// Every page resolves to its own route. "/login" is where main.tsx sends a // @auth
// 401, so losing it would land users on a not-found page. // @auth
// Every page resolves to its own route. // @!auth
test.each([
  ["/login", "/login"], // @auth
  ["/", "/_app/"], // home, the page that is yours
  ["/account", "/_app/account"], // @account
  ["/notifications", "/_app/notifications"], // @notifications
  ["/privacy", "/_app/privacy"], // @privacy
  ["/billing", "/_app/billing"], // @payments
  ["/admin", "/_app/admin"], // @admin
  ["/approvals", "/_app/approvals"], // @workflows
  // orgs:begin
  ["/org", "/_app/org/"],
  ["/org/members", "/_app/org/members"],
  ["/org/new", "/_app/org/new"],
  ["/invite/abc", "/invite/$token"],
  // orgs:end
])("%s resolves to %s", async (path, id) => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  await router.load()
  expect(router.state.matches.at(-1)?.routeId).toBe(id as never)
})
