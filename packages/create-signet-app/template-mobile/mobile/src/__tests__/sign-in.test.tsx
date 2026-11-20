import { beforeEach, expect, jest, test } from "@jest/globals"
import { fireEvent, screen } from "@testing-library/react-native"
import { Slot } from "expo-router"
import { renderRouter } from "expo-router/testing-library"
import { Text } from "react-native"
import SignIn from "@/app/(auth)/sign-in"
import { requestCode } from "@/lib/auth"
import { ThemeProvider } from "@/lib/theme"

jest.mock("@/lib/auth", () => ({ requestCode: jest.fn(async () => "+1 ••• 0199") }))
const sent = requestCode as jest.MockedFunction<typeof requestCode>

const routes = {
  _layout: () => (
    <ThemeProvider>
      <Slot />
    </ThemeProvider>
  ),
  "sign-in": SignIn,
  verify: () => <Text>Verify screen</Text>,
}

beforeEach(() => {
  sent.mockClear()
})

test("a number that cannot be a phone is caught before anything is sent", async () => {
  await renderRouter(routes, { initialUrl: "/sign-in" })
  await fireEvent.changeText(await screen.findByLabelText("Phone number"), "12")
  await fireEvent.press(screen.getByRole("button", { name: "Send code" }))
  expect(await screen.findByText("Enter your phone number with its country code.")).toBeTruthy()
  expect(sent).not.toHaveBeenCalled()
})

test("a valid number sends the code and opens the code screen", async () => {
  await renderRouter(routes, { initialUrl: "/sign-in" })
  await fireEvent.changeText(await screen.findByLabelText("Phone number"), "+1 555 010 0199")
  await fireEvent.press(screen.getByRole("button", { name: "Send code" }))
  expect(await screen.findByText("Verify screen")).toBeTruthy()
  expect(sent).toHaveBeenCalledWith("+15550100199")
})
