### signet-ui: page blocks

- New `./blocks/analytics-dashboard`, `./blocks/list-detail` and `./blocks/settings`: whole pages built from signet-ui components, with `labels`, `classNames`, `data-block` / `data-slot` hooks and `ready` / `loading` / `error` states. Each folder has a `block.json` (name, description, files, deps).
- `signet add block <name>` (signet-cli) copies a block and the components it uses into an app. The registry build fails when a `block.json` does not match what the block imports.
