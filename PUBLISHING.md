# Publishing

Packages are consumed by repos outside this monorepo (app-b first), so
`workspace:*` and `exports` pointing at `.ts` source are not enough. Both are
handled by `publishConfig`, which npm swaps in at publish time.

**Inside the monorepo nothing changes** — `exports` still points at `src/*.ts`,
so there is no build step in development.

## What publishing does differently

| | development | published |
|---|---|---|
| `exports` | `./src/index.ts` | `./dist/index.js` + `.d.ts` |
| cross-package deps | `workspace:*` | real version range |
| files shipped | — | `dist` only |

`prepublishOnly` runs the build, so a stale `dist` cannot be published.

## Scope

Published under `@dapplelight` (free tier), so **packages are public**. The `signet`
org name was taken, and the npm scope does not have to match the project name.

Free tier cannot publish private packages, so `access` is `public` everywhere.

### What that means, and what was done about it

Publishing is public and effectively permanent — npm restricts unpublish after
72 hours. The built output was therefore checked for anything that should not
be public, and two things were found and fixed:

- **Doc comments named private repos and their bugs.** Source comments carry the
  engineering history (`app-c compared signatures with !==`,
  `app-d skipped res.ok on 5 of 9 endpoints`). Valuable in the repo,
  not something to publish about live private projects. `removeComments` is now
  set in every build config: comments stay in source, never ship.
- **`appA.css` was renamed `finance.css`** and its header genericised. The
  overlay is "editorial plus a spend-category taxonomy", which is what it always
  was; naming it after a product was the accident.

`bun run build:all` then grep `packages/*/dist` for project names before any
release. The check is cheap and it has already caught a real leak.

## Release

```bash
cd ~/projects/signet
bun run release --dry-run      # pack everything, publish nothing
bun run release                # verify, then publish in dependency order
bun run release --otp 123456   # skip the interactive 2FA prompt
```

Publish output is deliberately **not** suppressed. bun asks for the one-time
password on stdout, so hiding it leaves the release hanging on a prompt you
cannot see — which is exactly what happened the first time.

Pass `--otp` to skip the prompt entirely, which is easier when publishing five
packages in a row.

`bun publish` publishes the package in the current directory and has no
`--workspaces` equivalent, and the repo root is `private: true` on purpose — the
monorepo is not a package. Running `bun publish` at the root fails with
"attempted to publish a private package". `bun run release` handles that by
publishing each package itself, in dependency order (config, tokens, lib, ui,
server, ai) so no consumer can hit a dependency that is not on the registry yet.

It runs `verify:publish` first and refuses to continue if that fails. If a
publish fails partway, it reports which packages are already live — those
cannot be taken back, so re-run and npm will reject the duplicates.

**Run `verify:publish` before every release.** Three separate publish-breaking
bugs passed typechecking, 284 unit assertions and a manual review, and were
caught only by installing the tarball in a clean directory:

1. **npm ignores `publishConfig.exports`** — a pnpm/bun extension. The tarball
   shipped `dist/` while `exports` pointed at `src/`, which was not in it. Every
   import would have failed. `exports` now points at `dist` directly.
2. **`workspace:^` is published literally by npm.** bun and pnpm expand it; npm
   does not, so consumers got an uninstallable dependency. Cross-package deps
   are pinned to `^0.1.0`, which works with any publisher and still links
   locally.
3. **TypeScript does not add file extensions.** Emitted `from "./types"` is
   unresolvable under Node ESM. It typechecked because `moduleResolution` is
   `"bundler"`, and bun resolved it happily. All relative imports now carry
   `.js`.

The verification probe runs under **Node, not bun** — bun tolerates
extensionless imports and would have hidden the third bug.

## Consumers

Every consuming repo and CI job needs an npm token, because the scope is
private:

```
# .npmrc
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
@signet:registry=https://registry.npmjs.org/
```

**Wrangler deploys need it too.** That is the cost of the private scope — it was
chosen with that tradeoff understood.

## Verified

- All five publishable packages build (`tsc -p tsconfig.build.json`; tokens
  copies CSS).
- Every path in every `publishConfig.exports` exists after a build — checked,
  not assumed. That check caught a `./themes/*` wildcard that resolved to
  nothing; the three themes are now listed explicitly.
- `dist/index.js` imports and exposes the expected symbols.
- Test types are excluded from the build, so a consumer does not inherit
  `@types/bun`.

## Releasing from CI (no login, no 2FA prompt)

`.github/workflows/release.yml` publishes through npm **Trusted Publishing**:
GitHub mints an OIDC token per run and `npm publish` (npm >= 11.5.1) exchanges
it for a short-lived publish credential. No npm token is stored anywhere, and
2FA stays on for the account — the tag push is the release action.

One-off setup, per package, on npmjs.com (signed in as the owner):
Settings → Trusted Publisher → GitHub Actions → repository `dapplelight/signet`,
workflow `release.yml`. Do it for every `@dapplelight/signet-*` package.

**A brand-new package cannot be set up this way before it exists.** The
Trusted Publisher form lives on the package's settings page, which npm only
creates on first publish, and without it CI has no credential for that package.
Publish the first version by hand (`npm login`, then `bun run release`, which skips
everything already on npm), then add the Trusted Publisher. `@dapplelight/signet-config`
is in that state until 0.1.0 is published. Until then every CI release fails at
it, and since it is first in the order, nothing after it publishes either: do the
manual publish before, or right after, merging it to main.

Then a release is: **bump the version in `packages/<name>/package.json` and
push to main.** The workflow runs on any push that touches a package's
package.json and publishes only versions npm does not have yet, so a push that
bumps nothing publishes nothing. A `release-*` tag or a manual run still works.

The apps pick releases up through Dependabot (`.github/dependabot.yml` in each
app repo), which opens one grouped PR for the `@dapplelight/signet-*` bumps.

The workflow runs lint, every package's tests and typecheck, then
`bun run release`, which in CI skips the `npm whoami` check (there is no
login) and publishes with npm instead of bun. No `--provenance`: npm only
attests builds from public repositories and this one is private.

The local `bun run release` still works as before, with `npm login`.

## Versioning: bump only what changed

Packages are versioned independently. `bun run release` skips any package whose
version is already on npm, so bumping one package publishes one package.
Bumping all five in lockstep republished unchanged code and made every release
wait on npm to process five uploads.

- Bump a package when its published contents change.
- Raise a dependent's range when it starts needing the new version — e.g. if
  `ai` needs something new in `lib` 0.1.10, set `ai`'s range to `^0.1.10` and
  bump `ai`. Today's ranges (`ui` → `tokens`, `ai` → `lib`) are `^0.1.0`.
- `create-signet-app` pins `lib`, `tokens` and `ui`; raise a pin when a scaffold
  needs the newer version.

## After a release

npm processes uploads asynchronously, so a version can be accepted and still
404 for several minutes (0.1.7 took about six). `bun run release` reports
"Uploaded N" and does one registry check; it does not wait. Before telling
anyone to install, run:

```bash
bun run release:status    # exit 0 only when every tarball is fetchable
```
