### create-signet-app (minor): arrow-key picker, api starter renamed api-billing

- Run with no flags on a terminal for an arrow-key picker (`@clack/prompts`):
  platforms and starters as two labeled groups, web by default, each hint kept
  to one line. Ctrl+C cancels with exit code 130. "Add MCP for agents?" uses the
  same prompt style. Off a terminal nothing changes: same output, same exit codes.
- The `api` starter is now `api-billing`, so it no longer shares a name with the
  `api` platform. `--starter api` still works and scaffolds `api-billing`.
