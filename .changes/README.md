# Changelog fragments

A PR with a user-visible change adds one file here instead of editing
CHANGELOG.md: `.changes/<short-name>.md`, written exactly like a CHANGELOG
entry and starting with its heading.

```md
### signet-server: notifications

- New `./notify/notifier`: ...
```

Name the packages before the colon, short or full: `signet-db`, `db, ui`,
`signet-db and signet-server`, `all packages`. Never bump a version in the PR.

After merge, the `post-merge` workflow bumps every named package once (patch;
write `(minor)` or `(major)` after a name for more, e.g.
`### signet-ui (minor): ...`), folds every fragment into CHANGELOG.md under
"## Unreleased" (file-name order), deletes them, regenerates API.md, and starts
the release, which publishes the new versions. PRs merged together ship in one
release.
