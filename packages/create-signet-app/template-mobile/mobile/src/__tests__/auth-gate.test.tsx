import { expect, test } from "@jest/globals"
import { act, screen } from "@testing-library/react-native"
import { Slot } from "expo-router"
import { renderRouter } from "expo-router/testing-library"
import { Text } from "react-native"
import RootLayout from "@/app/_layout"
import * as AuthLayout from "@/app/(auth)/_layout"
import { session } from "@/lib/session"

// The real root layout (the gate) over stand-in screens.
const routes = {
  _layout: RootLayout,
  "(auth)/_layout": AuthLayout,
  "(auth)/sign-in": () => <Text>Sign-in screen</Text>,
  "(auth)/verify": () => <Text>Verify screen</Text>,
  "(app)/_layout": () => <Slot />,
  "(app)/index": () => <Text>Home screen</Text>,
}

test("signed out: the sign-in screen, whatever the link", async () => {
  await session.clear()
  await renderRouter(routes, { initialUrl: "/" })
  expect(await screen.findByText("Sign-in screen")).toBeTruthy()
  expect(screen.queryByText("Home screen")).toBeNull()
})

test("signed in: a sign-in link opens the app instead", async () => {
  await session.set({ accessToken: "access", refreshToken: "refresh" })
  await renderRouter(routes, { initialUrl: "/sign-in" })
  expect(await screen.findByText("Home screen")).toBeTruthy()
})

test("signed in: the app, and back to sign-in once the session ends", async () => {
  await session.set({ accessToken: "access", refreshToken: "refresh" })
  await renderRouter(routes, { initialUrl: "/" })
  expect(await screen.findByText("Home screen")).toBeTruthy()
  // What a 401 the refresh could not fix does (lib/api.ts): the gate flips.
  await act(() => session.clear())
  expect(await screen.findByText("Sign-in screen")).toBeTruthy()
})
