### signet-cli: `signet add` and `signet upgrade` (own the code)

- New private package `@dapplelight/signet-cli` with a `signet` bin. `signet add <name>` copies a signet-ui item and the items it imports into the app as editable source (default `src/components/signet`), rewrites relative imports to the app's alias, records each copy's base hash in `signet.json` and prints the npm packages it still needs.
- `signet upgrade [name]` merges upstream changes into the copies: unedited files are replaced, edited ones get a 3-way `git merge-file`, and clashing lines keep conflict markers. `--dry-run` writes nothing. `signet diff <name>` shows what changed upstream since the copy; `signet list` shows every item and what is added, edited or out of date.
- `add` refuses to overwrite a file you edited when signet-ui also changed it, unless `--force`.
- The registry (files, internal deps, npm peers, content hashes) is generated from packages/ui by the package's `build`; nothing generated is committed.
- signet-mcp: new `add-component-source` recipe.
