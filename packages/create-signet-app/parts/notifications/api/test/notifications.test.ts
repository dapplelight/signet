import { expect, test } from "bun:test"
import { app, post, signIn } from "./helpers.ts"

test("a new account gets a welcome in the inbox; reading it clears the count", async () => {
  const cookie = await signIn("+919000000013")
  // Sends are deferred; the welcome lands in the inbox shortly.
  await Bun.sleep(100)
  const inbox = async () =>
    (await (await app.request("/api/notifications", { headers: { cookie } })).json()) as {
      items: { id: string; event: string }[]
      unreadCount: number
    }
  const first = await inbox()
  expect(first.items.map((i) => i.event)).toEqual(["account.welcome"])
  expect(first.unreadCount).toBe(1)
  expect((await post("/api/notifications/read-all", {}, cookie)).status).toBe(200)
  expect((await inbox()).unreadCount).toBe(0)
})
