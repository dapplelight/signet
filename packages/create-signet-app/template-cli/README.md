# `__APP_NAME__`

A CLI on Bun, compiled to one standalone binary, that signs in through
Signet's device code flow.

```
__PM_INSTALL__
__PM_RUN__ build        # dist/__APP_NAME__ for this platform
./dist/__APP_NAME__ login
./dist/__APP_NAME__ whoami
```

Without compiling: `bun src/index.ts login`.

## Server side

Mount `clientLoginRoutes` from `@dapplelight/signet-server/auth/hono` at
`/auth/client-login` and register this CLI as a client:

```ts
app.route(
  "/auth/client-login",
  clientLoginRoutes({
    trust: "cloudflare",
    clients: { __APP_NAME__: {} },
    verificationUri: "https://your.app/device",
  }),
)
```

Also pass `sessions`, `kv` and `rateLimit` (see signet-server's
`ClientLoginOptions`). `verificationUri` is the page where a signed-in user
types the code.

`src/config.ts` holds the client id, the mount path, the default API URL
(`API_URL` or `--api-url` override it) and the route `whoami` calls.

## How it works

- `login` asks `POST /device/code`, prints the code and link, then
  `src/poll.ts` polls `POST /token`, honouring `interval`, `slow_down`,
  `authorization_pending` and `expired_token`.
- Tokens live in a 0600 file in the OS config dir via `createSession` and
  `fileStorage`; the API client refreshes on a 401 through `tokenEndpointRefresh`.
- `logout` calls `POST /revoke` and deletes the file.
- Colour comes from the Signet tokens and is off under `NO_COLOR` or a pipe.

## Releasing

`.github/workflows/ci.yml` builds a binary per OS on `v*` tags. Add
`--target` to `bun build --compile` to cross-compile instead.
