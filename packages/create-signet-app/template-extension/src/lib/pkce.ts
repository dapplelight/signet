/** PKCE (RFC 7636), S256 only: the one method signet-server's /authorize accepts. */

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")

/** 32 random bytes as 43 unreserved characters (the spec asks for 43 to 128). */
export const randomString = () => b64url(crypto.getRandomValues(new Uint8Array(32)))

/** base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  )
}
