### signet-ui: user-facing screens (auth, account, notifications, privacy)

Ready screens under `@dapplelight/signet-ui/screens/*`, kept out of the main
barrel. Each takes plain data and callbacks shaped like the backend modules,
so an app wires them through `createRpcClient`:

- `screens/auth-screens`: `AuthScreen` (sign in / sign up with an email or
  phone one-time code, OAuth buttons), `VerifyCodeScreen`,
  `SessionExpiredScreen`, and their parts (`AuthCard`, `OAuthButtons`,
  `CodeRequestForm`, `VerifyCodeForm`…).
- `screens/account-screens`: `ProfileCard`, `SessionsList` (rows from
  signet-server's `sessionRoutes`, sign out one device or every other, with a
  confirm), `ApiKeysManager` (create shows the key once, then drops it;
  revoke confirms).
- `screens/notification-screens`: `NotificationInbox` (all / unread, mark
  read on open, mark all read, archive, load more, an all-caught-up state;
  `renderItem` turns rows into links) and `NotificationPreferences` (a switch
  per category and channel, required categories locked on, a failed save
  rolls back). Shapes match the notifier's `InboxItem` and `Prefs`.
- `screens/privacy-screens` (DPDP): `ConsentList` (one switch per purpose;
  withdrawing is as easy as giving, no confirm; shows the notice version and
  date) and `DataRequests` (export and erasure requests with status, erasure
  confirms, a pending request blocks a duplicate, completed exports
  download). Shapes match signet-db's `Consent` and `DataRequest`.

Every string is a prop (`labels`, spread from `DEFAULT_*_LABELS`), every part
takes `className` (composites also `classNames`) with state as `data-*`,
stateful parts are controlled or uncontrolled, and each file's `// Recipe:`
line lists its behaviours for signet-mcp's `compose_component` (which now
indexes `./screens/*`). Files import only signet-ui parts, so they copy in.
