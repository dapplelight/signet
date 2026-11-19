### create-signet-app (minor): dashboard and pwa starters

- New `dashboard` part and starter: the shell's nav moves into signet-ui's `Sidebar`
  (a drawer on phones) and home becomes an overview of stat tiles, a bar chart
  and a recent-activity table on sample data, with loading, empty and error
  states. No chart library: plain bars.
- New `pwa` part and starter: web manifest, a placeholder SVG icon, a
  hand-written service worker that keeps the app shell offline (never caches
  `/api`), and an "Install app" button while the browser offers it. No new
  dependencies.
- Both are web only: `--api` with either is an error. `full` leaves them out.
