/** PKCE (RFC 7636, S256) and a state value, from the webview's WebCrypto. */

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")

/** 32 random bytes, base64url: 43 characters, inside the verifier's 43-128. */
export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)))

/** base64url(SHA-256(verifier)), the `code_challenge` for `code_challenge_method=S256`. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(digest))
}

export async function createPkce() {
  const verifier = randomToken()
  return { verifier, challenge: await pkceChallenge(verifier), state: randomToken() }
}
