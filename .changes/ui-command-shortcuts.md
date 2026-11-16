### ui: shortcuts in the command palette, and a phone sheet for CommandDialog

- `ShortcutCommands` (from `shortcuts`): every described single-key shortcut becomes a palette item, one group per `meta.group`, with its keys shown; choosing one runs it. Drop it inside a `CommandList`. Sequences ("G then I") stay in the `?` overlay.
- Shortcuts registered with `enabled: false` are no longer listed in the `?` overlay.
- `CommandDialog` opens as a bottom sheet on phones (85% height, list fills it). Desktop is unchanged.
