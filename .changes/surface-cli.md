### create-signet-app: `--template cli`

- New `cli` template: a Bun CLI that signs in through signet-server's device code flow (`login`, `logout`, `whoami`), keeps tokens in a 0600 file under the OS config dir via `createSession` and `fileStorage`, and compiles to one binary with `bun build --compile`. Ships a CI matrix that builds a binary per OS on tags, and a unit-tested poll loop that honours `interval`, `slow_down`, `authorization_pending` and `expired_token`. Colour comes from `@dapplelight/signet-tokens/ansi` and respects `NO_COLOR` and pipes. No CLI framework: `node:util` `parseArgs` only.

### signet-tokens: React Native guide, `nativeTheme` takes `useColorScheme()` as is

- `nativeTheme(name, scheme)` now accepts `null` and `"unspecified"` (anything but `"dark"` is light), so `nativeTheme("editorial", useColorScheme())` typechecks. The README has an Expo / React Native section.
