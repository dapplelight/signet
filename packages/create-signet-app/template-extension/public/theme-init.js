// Applies the stored theme before first paint. MV3 forbids inline scripts, so
// this is a file, loaded as a classic script that runs before the page paints.
try {
  const t = localStorage.getItem("signet-theme")
  const d =
    t === "dark" || ((!t || t === "system") && matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", d)
  document.documentElement.style.colorScheme = d ? "dark" : "light"
} catch {}
