// Every string the app shows lives in src/locales/<language>.json; components
// call t("…") from useTranslation(). A new language = a new file + an entry in
// `resources`. The browser's language picks the file, English is the fallback.
// Money and dates: Intl via @dapplelight/signet-lib/format, not here.
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import en from "../locales/en.json"

// Pseudo-locale for review screenshots, dev only: open the app with ?pseudo=1
// and every string comes out accented and ~35% longer in brackets, so text that
// skipped t() (plain letters) and text that gets cut off both show at a glance.
const PLAIN = "aeiouycnAEIOUYCN"
const ACCENTED = [..."åéîöüýçñÅÉÎÖÜÝÇÑ"]
export const pseudo = (s: string) =>
  `[${s.replace(/[a-zA-Z]/g, (c) => ACCENTED[PLAIN.indexOf(c)] ?? c)}${"~".repeat(Math.ceil(s.length * 0.35))}]`

const usePseudo =
  import.meta.env.DEV && new URLSearchParams(globalThis.location?.search).has("pseudo")

i18n
  .use({ type: "postProcessor", name: "pseudo", process: (v: string) => pseudo(v) })
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    lng: globalThis.navigator?.language?.split("-")[0] ?? "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    ...(usePseudo ? { postProcess: ["pseudo"] } : {}),
  })

export default i18n
