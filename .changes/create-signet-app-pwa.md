### create-signet-app: web template is an installable PWA

The web template now builds a service worker with `vite-plugin-pwa` (injectManifest) and Workbox, added as template dev dependencies only:

- precaches the built app and serves `public/offline.html` when a page load has no network; `/api/*` always goes to the network, so nothing private is cached
- checks for a new deploy when the app returns to the foreground and every 30 minutes, shows a "Reload" toast, and applies the update by itself the next time the app is in the background
- handles web push (`{ title, message, url, tag }`) and opens the URL on click
- `manifest.webmanifest` with the app name; add icons under `public/` and list them in `vite.config.ts`

Nothing runs under `bun run dev`; only built or previewed apps register the worker.
