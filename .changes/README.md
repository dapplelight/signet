# Changelog fragments

A PR with a user-visible change adds one file here instead of editing
CHANGELOG.md: `.changes/<short-name>.md`, written exactly like a CHANGELOG
entry and starting with its heading.

```md
### signet-server: notifications

- New `./notify/notifier`: ...
```

After merge, the `post-merge` workflow folds every fragment into CHANGELOG.md
under "## Unreleased" (file-name order), deletes them, and regenerates API.md.
