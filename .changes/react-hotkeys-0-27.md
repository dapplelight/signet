### signet-ui (minor): @tanstack/react-hotkeys 0.27

- The optional peer `@tanstack/react-hotkeys` moves from `>=0.12.0 <0.13.0` to `>=0.27.0 <0.28.0`. Apps that use `components/shortcuts` need to upgrade it too, and `useHotkeySequence(["G", "I"], …)` becomes `useHotkey(["G", "I"], …)`: TanStack folded sequences into `useHotkey` in 0.14.
- `useShortcutList`, `ShortcutsHelp` and `ShortcutCommands` read the single registration list that `useHotkeyRegistrations()` now returns. Key labels now come from `useFormatForDisplay()`, so they follow the platform and, where the browser reports it, the user's keyboard layout.
