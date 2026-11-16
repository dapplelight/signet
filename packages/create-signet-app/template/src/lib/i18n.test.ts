import { expect, test } from "bun:test"
import en from "../locales/en.json"
import i18n, { pseudo } from "./i18n"

test("t() reads src/locales/en.json", () => {
  expect(i18n.t("login.title")).toBe(en.login.title)
})

test("pseudo accents letters and pads ~35%", () => {
  expect(pseudo("Sign in")).toBe("[Sîgñ îñ~~~]")
})
