// One stylesheet per theme, built by Tailwind and loaded on demand. Themes
// cannot be stacked in one page: each one resolves Tailwind's utilities
// (text-sm, rounded-lg...) to different values at build time, so switching
// swaps the whole stylesheet. Light/dark is separate: the `.dark` class.
const sheets = import.meta.glob<string>("./themes/*.css", { query: "?inline", import: "default" })

export const THEMES = Object.keys(sheets)
  .map((path) => path.replace(/^.*\/(.+)\.css$/, "$1"))
  .sort()

const KEY = "showcase-theme"

export function initialTheme(): string {
  // ?theme=cinematic links straight to a theme.
  const saved = new URLSearchParams(location.search).get("theme") ?? localStorage.getItem(KEY)
  return saved && THEMES.includes(saved) ? saved : "editorial"
}

export async function applyTheme(name: string): Promise<void> {
  const css = await sheets[`./themes/${name}.css`]()
  let el = document.getElementById("theme-css")
  if (!el) {
    el = document.createElement("style")
    el.id = "theme-css"
    document.head.append(el)
  }
  el.textContent = css
  document.documentElement.dataset.themeName = name
  localStorage.setItem(KEY, name)
}
