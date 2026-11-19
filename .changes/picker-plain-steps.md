### create-signet-app: the picker asks in plain steps

- On a terminal, a missing project name is asked for (default `my-app`)
  instead of being an error. Off a terminal it is still an error.
- "What are you building?" has five plain rows: web app, API only,
  command-line tool, browser extension, desktop app, each explained on its
  own line.
- For a web app or an API, "Start from" lists the ready-made mixes in words
  (just the basics, the starters, everything last), then "Features" lists
  every part with the mix's parts already ticked, to add or remove. Ticks that
  equal a starter scaffold that starter; anything else is `--with` (plus
  `--api` on the API path). The API path offers Sign-in + billing
  (`api-billing`) and everything (`--starter full --api`), and no web-only
  parts.
- A theme question where there is a web UI (Enter keeps editorial), and the
  MCP question now reads "Let AI coding agents work with this app? (adds an
  MCP server)".
- Before creating, a summary shows what will be made and the one-line command
  that builds the same app.
- Every starter in `STARTERS` has a `label`, the picker's row text.
- Off a terminal nothing else changes.
