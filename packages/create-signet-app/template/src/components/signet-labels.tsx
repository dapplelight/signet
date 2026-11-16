// Signet's components say a few words by themselves ("Close", "Search…", table
// headers, aria labels). This passes them through t(), so they live in
// src/locales/*.json under "signet" with the rest of the app's text.
import { defaultLabels, type Labels, LabelsProvider } from "@dapplelight/signet-ui"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

export function SignetLabels({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const labels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(defaultLabels).map(([key, en]) => [
          key,
          typeof en === "function"
            ? (value: string) => t(`signet.${key}`, { value })
            : t(`signet.${key}`),
        ]),
      ) as Labels,
    [t],
  )
  return <LabelsProvider labels={labels}>{children}</LabelsProvider>
}
