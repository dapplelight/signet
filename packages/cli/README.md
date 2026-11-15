# @dapplelight/signet-cli

`signet add` copies signet-ui components into your app as source you own and
edit. `signet upgrade` brings later signet-ui changes into those copies with a
3-way merge, so your edits survive. This is the last customisation level:
when tokens, props, `className` and parts are not enough, own the code.

Not on npm yet. Inside the Signet repo, run it with
`bun packages/cli/src/index.ts <command> --cwd <app>` after
`bun run build` in `packages/cli`.

## Add a component

```bash
signet add dialog
```

This copies `dialog` and what it imports from signet-ui (`button`, `utils`)
into `src/components/signet/`, keeping signet-ui's layout
(`components/ui/dialog.tsx`, `lib/utils.ts`), and rewrites relative imports
to your alias:

```ts
import { cn } from "@/components/signet/lib/utils"
```

Then import from your copy instead of the package:

```ts
import { Dialog } from "@/components/signet/components/ui/dialog"
```

It prints the npm packages the copies need that your `package.json` lacks, as
a `bun add` line. Run `signet list` for every item name; any subpath of
signet-ui's exports map is an item (`button`, `data-table`, `utils`,
`behaviors`, `trend-chip`).

`add` never overwrites a file you have edited when signet-ui also changed it:
it writes nothing, lists the files, and points you to `signet upgrade`.
`--force` overwrites them. An edited file that signet-ui did not change is
left alone.

## Configuration

`signet.json` at the app root. `add` creates it on first use:

```json
{
  "dir": "src/components/signet",
  "alias": "@/components/signet",
  "items": { "dialog": { "version": "0.2.2", "hash": "…" } },
  "files": { "components/ui/dialog.tsx": "…" }
}
```

- `dir`: where copies go. `--dir` on `add` sets it.
- `alias`: the import prefix that points at `dir` (create-signet-app's `@/`
  maps to `src/`). `--alias ""` keeps signet-ui's relative imports.
- `items` and `files`: written by the CLI, the signet-ui version and content
  hash each copy started from.

`.signet/base/` holds the copies exactly as they were written. Upgrades merge
against them, so commit both `signet.json` and `.signet/`.

## Upgrade

```bash
signet diff dialog          # what changed in signet-ui since you copied it
signet upgrade --dry-run    # what an upgrade would do, writing nothing
signet upgrade dialog       # or no name: every added item
```

Per file: a copy you never edited is replaced; one only you changed is kept; one
both sides changed gets `git merge-file` (base, upstream, yours). Where the same
lines changed on both sides, the file keeps conflict markers:

```
<<<<<<< app
your line
=======
signet-ui's line
>>>>>>> signet-ui 0.3.0
```

Resolve them and run your checks. The command exits 1 when any file has
conflicts or could not be merged. Without git on the machine, edited files
are reported as `needs-merge` and left untouched; `signet diff` shows the
upstream change to apply by hand. A dependency signet-ui added to an item is
copied in on upgrade.

## Commands

```
signet add <name...>      [--force] [--dir <path>] [--alias <prefix>]
signet upgrade [name...]  [--dry-run]
signet diff <name>
signet list
```

Every command takes `--cwd <app>` and `--json`.

## The registry

`bun run build` reads `packages/ui` and writes `dist/registry.json`: each
item's files and contents, the items it depends on, the npm packages it
imports with signet-ui's range, and a content hash. It is generated, not
committed, and ships in the published package.
