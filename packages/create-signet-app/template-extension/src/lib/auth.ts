import {
  createSession,
  fromTokenResponse,
  tokenEndpointRefresh,
} from "@dapplelight/signet-lib/session"
import { chromeStorage } from "@dapplelight/signet-lib/storage"
import { API_BASE, CLIENT_ID } from "../config"
import { pkceChallenge, randomString } from "./pkce"

// Tokens live in chrome.storage.local, shared by the popup, the options page
// and the service worker. A refresh the server refuses signs out.
export const session = createSession({
  storage: chromeStorage(),
  refresh: tokenEndpointRefresh(`${API_BASE}/auth/token`, CLIENT_ID),
})

/**
 * Authorization code + PKCE in a browser window. The redirect URI is
 * https://<extension-id>.chromiumapp.org/: register it for CLIENT_ID in the
 * server's `clients`. The user signs in on the web app first if they are not.
 */
export async function signIn(): Promise<void> {
  const redirectUri = chrome.identity.getRedirectURL()
  const verifier = randomString()
  const state = randomString()
  const url = new URL(`${API_BASE}/auth/authorize`)
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    state,
  }).toString()

  const result = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true })
  const back = new URL(result ?? "")
  if (back.searchParams.get("state") !== state) throw new Error("Sign-in state did not match")
  const code = back.searchParams.get("code")
  if (!code) throw new Error(back.searchParams.get("error") ?? "Sign-in was not completed")

  const res = await fetch(`${API_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed (HTTP ${res.status})`)
  await session.set(fromTokenResponse(await res.json()))
}

/** Forgets the session, and asks the server to revoke it (always answers 200). */
export async function signOut(): Promise<void> {
  const tokens = await session.get()
  await session.clear()
  if (tokens?.refreshToken)
    await fetch(`${API_BASE}/auth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken }),
    }).catch(() => {})
}
