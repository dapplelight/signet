/**
 * The OpenAPI 3.1 document for the auth routes in
 * `@dapplelight/signet-server/auth/hono`: `sessionRoutes` and
 * `clientLoginRoutes`. Hand-assembled, because `openApiSpec` in the server
 * reads a route's `zValidator`s and answers every error as the Signet envelope,
 * and these routes read their own form or JSON bodies and answer OAuth errors.
 * Request and response shapes are Zod, converted the same way as the other
 * spec files; every value mirrors `auth/client-login.ts` in the server.
 */
import { z } from "zod"
import { errorEnvelopeSchema, SPEC_VERSION } from "../src/error"

type Json = Record<string, unknown>

const schema = (s: z.ZodType): Json => {
  const { $schema: _, ...rest } = z.toJSONSchema(s, { io: "input" }) as Json
  return rest
}
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

/** `DEVICE_CODE_GRANT` in the server's client-login.ts. */
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"

/** One OAuth failure body: `{ error, error_description? }`, plus `interval` with `slow_down`. */
const oauthError = (codes: [string, ...string[]], withInterval = false) =>
  schema(
    z.object({
      error: z.enum(codes),
      error_description: z.string().optional(),
      ...(withInterval
        ? {
            interval: z
              .number()
              .int()
              .describe("With slow_down: the poll interval to use from now on, in seconds.")
              .optional(),
          }
        : {}),
    }),
  )

const sessionSchema = z.object({
  id: z.string(),
  device: z.string().describe('"Chrome on macOS", from the user agent at sign-in.'),
  ip: z
    .string()
    .nullable()
    .describe("Client IP at sign-in, then at the last touch; null when the app trusts no proxy."),
  createdAt: z.number().int().describe("Epoch ms."),
  lastSeenAt: z.number().int().describe("Epoch ms."),
  expiresAt: z.number().int().describe("Epoch ms."),
  current: z.boolean().describe("True for the session making this request."),
})

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().describe("Seconds."),
  refresh_token: z.string().describe("Single use: each refresh returns a new one."),
})

const deviceCodeResponseSchema = z.object({
  device_code: z.string(),
  user_code: z.string().describe("Shown to the user as XXXX-XXXX."),
  verification_uri: z.string(),
  verification_uri_complete: z.string(),
  expires_in: z.number().int().describe("Seconds."),
  interval: z.number().int().describe("Minimum seconds between polls."),
})

const clientId = z.string().describe("A registered client id.")
const codeGrantRequest = z.object({
  grant_type: z.literal("authorization_code"),
  client_id: clientId,
  code: z.string(),
  redirect_uri: z.string().describe("The redirect_uri sent to /authorize."),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
})
const refreshGrantRequest = z.object({
  grant_type: z.literal("refresh_token"),
  client_id: clientId,
  refresh_token: z.string(),
})
const deviceGrantRequest = z.object({
  grant_type: z.literal(DEVICE_CODE_GRANT),
  client_id: clientId,
  device_code: z.string(),
})

/** The same schema as a form or a JSON body. */
const body = (s: Json) => ({
  required: true,
  content: {
    "application/x-www-form-urlencoded": { schema: s },
    "application/json": { schema: s },
  },
})
const json = (s: Json, description: string, headers?: Json) => ({
  description,
  ...(headers ? { headers } : {}),
  content: { "application/json": { schema: s } },
})

const NO_STORE = { "Cache-Control": { $ref: "#/components/headers/CacheControlNoStore" } }
const RETRY_AFTER = { "Retry-After": { $ref: "#/components/headers/RetryAfter" } }
const UNAUTHORIZED = { $ref: "#/components/responses/Unauthorized" }
const COOKIE = [{ storedSession: [] as string[] }]
/** `sessionRoutes` mounts apart from `clientLoginRoutes`: its middleware gates every path under its prefix. */
const SESSIONS_SERVERS = [
  {
    url: "{sessionsPrefix}",
    description: "Where sessionRoutes is mounted.",
    variables: { sessionsPrefix: { default: "/api/sessions" } },
  },
]

export function authOpenApi(): Json {
  return {
    openapi: "3.1.0",
    "x-specVersion": SPEC_VERSION,
    info: {
      title: "Signet auth routes",
      version: SPEC_VERSION,
      description:
        "sessionRoutes (the signed-in user's devices) and clientLoginRoutes (bearer sign-in for extensions, desktop apps and CLIs) from @dapplelight/signet-server/auth/hono. " +
        "Session routes answer failures in Signet's error envelope. Client-login routes answer in OAuth's shape, `{ error, error_description? }`, with `Cache-Control: no-store`, and `Retry-After` when rate limited.",
    },
    servers: [
      {
        url: "{authPrefix}",
        description: "Where clientLoginRoutes is mounted.",
        variables: { authPrefix: { default: "/api/auth" } },
      },
    ],
    tags: [{ name: "Sessions" }, { name: "Client login" }],
    paths: {
      "/": {
        servers: SESSIONS_SERVERS,
        get: {
          operationId: "listSessions",
          tags: ["Sessions"],
          summary: "List the signed-in user's sessions",
          security: COOKIE,
          responses: {
            "200": json(
              {
                type: "object",
                properties: { sessions: { type: "array", items: ref("Session") } },
                required: ["sessions"],
              },
              "Live sessions, newest activity first.",
            ),
            "401": UNAUTHORIZED,
          },
        },
      },
      "/revoke-others": {
        servers: SESSIONS_SERVERS,
        post: {
          operationId: "revokeOtherSessions",
          tags: ["Sessions"],
          summary: "Sign out everywhere else",
          security: COOKIE,
          responses: {
            "200": json(ref("Revoked"), "How many other sessions were revoked."),
            "401": UNAUTHORIZED,
          },
        },
      },
      "/{id}": {
        servers: SESSIONS_SERVERS,
        delete: {
          operationId: "revokeSession",
          tags: ["Sessions"],
          summary: "Revoke one of the user's sessions",
          description:
            "Revoking the current session also clears the session cookie. Another user's session reads as missing.",
          security: COOKIE,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": json(
              { type: "object", properties: { revoked: { const: 1 } }, required: ["revoked"] },
              "Revoked.",
              {
                "Set-Cookie": {
                  description: "Clears the session cookie when the current session was revoked.",
                  schema: { type: "string" },
                },
              },
            ),
            "401": UNAUTHORIZED,
            "404": {
              description: "No such session of this user (code NOT_FOUND).",
              content: { "application/json": { schema: ref("Error") } },
            },
          },
        },
      },
      "/authorize": {
        get: {
          operationId: "authorize",
          tags: ["Client login"],
          summary: "Authorization code with PKCE (S256 only)",
          description:
            "For a user signed in on the web. Redirects to the client's redirect_uri with `code` and `state`. A PKCE error is sent to the redirect_uri as `error` and `error_description`. An unknown client_id or unregistered redirect_uri is never redirected to. A visitor who is not signed in is redirected to the app's login page when the app sets loginUrl, otherwise answered 401.",
          security: COOKIE,
          parameters: [
            { name: "client_id", in: "query", required: true, schema: { type: "string" } },
            {
              name: "redirect_uri",
              in: "query",
              required: true,
              description:
                "Matched exactly against the client's registered redirectUris; a portless loopback entry matches any port.",
              schema: { type: "string" },
            },
            {
              name: "code_challenge",
              in: "query",
              required: true,
              description: "base64url(SHA-256(code_verifier)).",
              schema: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
            },
            {
              name: "code_challenge_method",
              in: "query",
              required: true,
              schema: { const: "S256" },
            },
            { name: "state", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: {
            "302": {
              description:
                "Redirect to redirect_uri?code&state, to redirect_uri?error&error_description, or to the login page.",
              headers: { Location: { required: true, schema: { type: "string" } } },
            },
            "400": json(
              oauthError(["invalid_client", "invalid_request"]),
              "Unknown client_id (invalid_client) or unregistered redirect_uri (invalid_request).",
              NO_STORE,
            ),
            "401": { ...UNAUTHORIZED, description: "Not signed in and the app sets no loginUrl." },
          },
        },
      },
      "/token": {
        post: {
          operationId: "token",
          tags: ["Client login"],
          summary: "Exchange a grant for tokens",
          description:
            "grant_type is `authorization_code` (with code_verifier), `refresh_token` or the device code grant. A refresh token is single use and rotated; presenting a used one revokes the session. A form or JSON body.",
          requestBody: body({
            oneOf: [ref("CodeGrantRequest"), ref("RefreshGrantRequest"), ref("DeviceGrantRequest")],
          }),
          responses: {
            "200": json(ref("TokenResponse"), "A new access and refresh token.", NO_STORE),
            "400": json(
              oauthError(
                [
                  "invalid_request",
                  "invalid_grant",
                  "unsupported_grant_type",
                  "authorization_pending",
                  "slow_down",
                  "expired_token",
                ],
                true,
              ),
              "authorization_pending and slow_down are the device flow's polling answers.",
              NO_STORE,
            ),
            "401": json(oauthError(["invalid_client"]), "Unknown client_id.", NO_STORE),
          },
        },
      },
      "/device/code": {
        post: {
          operationId: "deviceCode",
          tags: ["Client login"],
          summary: "Start the device flow (RFC 8628)",
          description: "Counted per client IP.",
          requestBody: body(schema(z.object({ client_id: clientId }))),
          responses: {
            "200": json(
              ref("DeviceCodeResponse"),
              "A device code to poll with and a user code to show.",
              NO_STORE,
            ),
            "401": json(oauthError(["invalid_client"]), "Unknown client_id.", NO_STORE),
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/device/approve": {
        post: {
          operationId: "deviceApprove",
          tags: ["Client login"],
          summary: "Approve a device's user code",
          description:
            "For a user signed in on the web. Single use; counted per user against guessing.",
          security: COOKIE,
          requestBody: body(
            schema(
              z.object({
                user_code: z
                  .string()
                  .describe('As shown, "BCDF-GHJK"; case and separators are ignored.'),
              }),
            ),
          ),
          responses: {
            "200": json(ref("DeviceApproveResponse"), "Approved."),
            "400": json(oauthError(["invalid_code"]), "Not a valid, live, unused code.", NO_STORE),
            "401": UNAUTHORIZED,
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/revoke": {
        post: {
          operationId: "revoke",
          tags: ["Client login"],
          summary: "Sign a client out (RFC 7009)",
          description:
            "Revokes the session behind a refresh or access token. An unknown token is ignored: the answer is always 200.",
          requestBody: body(schema(z.object({ token: z.string() }))),
          responses: { "200": { description: "Always, with an empty body." } },
        },
      },
    },
    components: {
      schemas: {
        Error: schema(errorEnvelopeSchema),
        Session: schema(sessionSchema),
        Revoked: schema(
          z.object({ revoked: z.number().int().describe("How many sessions were revoked.") }),
        ),
        TokenResponse: schema(tokenResponseSchema),
        DeviceCodeResponse: schema(deviceCodeResponseSchema),
        DeviceApproveResponse: schema(z.object({ ok: z.literal(true), client_id: z.string() })),
        CodeGrantRequest: schema(codeGrantRequest),
        RefreshGrantRequest: schema(refreshGrantRequest),
        DeviceGrantRequest: schema(deviceGrantRequest),
      },
      responses: {
        Unauthorized: {
          description: "No valid stored-session cookie (code UNAUTHORIZED).",
          content: { "application/json": { schema: ref("Error") } },
        },
        RateLimited: json(
          oauthError(["rate_limited"]),
          "Too many attempts; retry after the Retry-After seconds.",
          { ...NO_STORE, ...RETRY_AFTER },
        ),
      },
      headers: {
        CacheControlNoStore: { required: true, schema: { const: "no-store" } },
        RetryAfter: { required: true, description: "Seconds.", schema: { type: "integer" } },
      },
      securitySchemes: {
        storedSession: {
          type: "apiKey",
          in: "cookie",
          name: "sid",
          description:
            "The stored-session cookie from startSession (./sessions). Its name is the app's cookieName; `sid` is the example's.",
        },
      },
    },
  }
}
