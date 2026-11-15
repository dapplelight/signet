### signet-ui: user-facing screens (auth, account, notifications, privacy)

Ready screens under `@dapplelight/signet-ui/screens/*`, kept out of the main
barrel. Each takes plain data and callbacks shaped like the backend modules,
so an app wires them through `createRpcClient`:

- `screens/auth-screens`: `AuthScreen` (sign in / sign up with an email or
  phone one-time code, OAuth buttons), `VerifyCodeScreen`,
  `SessionExpiredScreen`, and their parts (`AuthCard`, `OAuthButtons`,
  `CodeRequestForm`, `VerifyCodeForm`…).

Every string is a prop (`labels`, spread from `DEFAULT_*_LABELS`), every part
takes `className` (composites also `classNames`) with state as `data-*`,
stateful parts are controlled or uncontrolled, and each file's `// Recipe:`
line lists its behaviours for signet-mcp's `compose_component` (which now
indexes `./screens/*`). Files import only signet-ui parts, so they copy in.
