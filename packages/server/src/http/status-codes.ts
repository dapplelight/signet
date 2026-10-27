// No hono import here: `/mcp` reads these codes and must load without hono.

/**
 * The code for an HTTPException thrown without one (auth's 401s, Hono's own).
 * Kept in step with ERROR_CODES in @dapplelight/signet-lib/api by the server test.
 */
export const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  422: "UNPROCESSABLE",
  429: "RATE_LIMITED",
}
