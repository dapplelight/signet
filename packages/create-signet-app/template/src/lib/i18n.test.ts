import { expect, test } from "bun:test"
import en from "../locales/en.json"
import i18n, { pseudo } from "./i18n"

test("t() reads src/locales/en.json", () => {
  expect(i18n.t("login.title")).toBe(en.login.title)
})

test("pseudo accents letters and pads ~35%", () => {
  expect(pseudo("Sign in")).toBe("[Sîgñ îñ~~~]")
})

test("Signet's own labels are in en.json, with {{value}} for the ones that take one", () => {
  expect(i18n.t("signet.close")).toBe("Close")
  expect(i18n.t("signet.deleteView", { value: "Q3" })).toBe("Delete view Q3")
})
