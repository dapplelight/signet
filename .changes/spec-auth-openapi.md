### spec: OpenAPI document for the auth routes

- New `@dapplelight/signet-spec/openapi/auth.openapi.json` (also served at `/spec/v1/auth.openapi.json`): OpenAPI 3.1 for `sessionRoutes` and `clientLoginRoutes`, including the PKCE, token, device-flow and revoke routes and their OAuth error shape. A test checks every response of the real routes against it.
