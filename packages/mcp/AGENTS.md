# Working on @dapplelight/signet-mcp

For an agent changing this package. To use the server, read the README.

- `src/generated/` is written by `bun run gen` (`scripts/build-index.ts`).
  Never edit it by hand. Run `bun run gen` after any change to a doc, an
  `exports` map, a component, a theme, CONTRACT.md, the doctor, the contrast
  test or create-signet-app's templates, and commit the result. `bun run test`
  fails while it is stale.
- Answers come from the repo, never from text written here. A new tool
  reads the index; if the index lacks something, extend the generator.
- Recipes are lists of doc headings in `RECIPES` in the generator. The steps
  are the docs' own sections, so fix a recipe by fixing the doc.
- Tools are built with `@dapplelight/signet-server/mcp`. Do not call the SDK's
  `registerTool` directly.
- `check_app`'s `path` reads the local disk and exists only when `fs: true`
  (the stdio bin). Keep it off for anything hosted.
- Nothing may write to stdout in the bin except the transport.
- Checks: `bun run build && bun run test && bun run typecheck` here, and
  `bun run lint` at the root.

## Adding later

- A new package (for example a database package) is picked up by `bun run
  gen` with no change: its README becomes `signet://docs/<dir>`, its exports
  are indexed. Add a recipe for it in `RECIPES`.
- Tools a package ships for agents go in `signetTools()` in `src/tools.ts`,
  or an app passes its own through `signetMcpOptions({ tools })`.
