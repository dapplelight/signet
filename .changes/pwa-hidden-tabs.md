### create-signet-app: PWA update applies only when every tab is hidden

Activating a new service worker reloads every open tab, so a background tab applying the update reloaded the one in use. A hidden tab now asks the worker, which applies the update only when no window of the app is visible; the last tab to go to the background applies it.
