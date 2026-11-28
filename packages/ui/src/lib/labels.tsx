import { createContext, useContext, useMemo } from "react"

/**
 * The words Signet's components say by themselves (not text you pass in).
 * English by default; wrap the app once to translate them with any i18n library:
 *
 *   <LabelsProvider labels={{ close: t("close"), search: t("search") }}>
 *
 * A component prop for the same text, where one exists, still wins.
 */
export const defaultLabels = {
  close: "Close",
  somethingWentWrong: "Something went wrong",
  tryAgain: "Try again",
  previousPage: "Previous page",
  nextPage: "Next page",
  theme: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
  search: "Search",
  searchPlaceholder: "Search…",
  selectAllRows: "Select all rows",
  noValues: "No values",
  toggleColumns: "Toggle columns",
  savedViews: "Saved views",
  noSavedViews: "No saved views",
  viewName: "View name",
  saveViewPlaceholder: "Save current view as…",
  deleteView: (name: string) => `Delete view ${name}`,
  otherEmoji: "Other emoji",
  otherEmojiPlaceholder: "Other…",
  actions: "Actions",
  upload: "Upload",
  uploading: (file: string) => `Uploading ${file}`,
  noData: "No data.",
  clear: "Clear",
  reset: "Reset",
  columns: "Columns",
  views: "Views",
  save: "Save",
  selectRow: (id: string) => `Select row ${id}`,
  resizeColumn: (id: string) => `Resize column ${id}`,
  filterBy: (column: string) => `Filter ${column}`,
  switchToLight: "Switch to light theme",
  switchToDark: "Switch to dark theme",
  linkToSection: (heading: string) => `Link to ${heading || "this section"}`,
  job: "Job",
  status: "Status",
  attempts: "Attempts",
  progress: "Progress",
  error: "Error",
  retry: "Retry",
  cancel: "Cancel",
  retryItem: (what: string) => `Retry ${what}`,
  cancelItem: (what: string) => `Cancel ${what}`,
  submit: "Submit",
  addItem: "Add",
  removeItem: "Remove",
  chooseOption: "Choose…",
  skipToContent: "Skip to content",
  showMore: "Show more",
  showLess: "Show less",
}

export type Labels = typeof defaultLabels

const LabelsContext = createContext<Labels>(defaultLabels)

export function LabelsProvider({
  labels,
  children,
}: {
  labels: Partial<Labels>
  children: React.ReactNode
}) {
  const parent = useContext(LabelsContext)
  const value = useMemo(() => ({ ...parent, ...labels }), [parent, labels])
  return <LabelsContext.Provider value={value}>{children}</LabelsContext.Provider>
}

export function useLabels(): Labels {
  return useContext(LabelsContext)
}
