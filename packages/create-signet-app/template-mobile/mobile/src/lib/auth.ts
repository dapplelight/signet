import { fromTokenResponse } from "@dapplelight/signet-lib/session"
import { analytics } from "./analytics"
import { api, queryClient, type User } from "./api"
import { outbox } from "./outbox"
import { unregisterPush } from "./push"
import { CLIENT_ID, session } from "./session"

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number }

/** Text a one-time code to `phone`. Resolves the masked number it went to. */
export async function requestCode(phone: string): Promise<string> {
  const r = await api.post<{ to: string }>("/api/auth/otp", { phone })
  return r.to
}

/** Trade the code for this phone's token pair; the gate then shows the app. */
export async function verifyCode(phone: string, code: string): Promise<User> {
  const r = await api.post<{ user: User; tokens: TokenResponse }>(
    `/api/auth/verify?client_id=${CLIENT_ID}`,
    { phone, code },
  )
  analytics.identify(r.user.id)
  await session.set(fromTokenResponse(r.tokens))
  return r.user
}

/** Sign out here: the API revokes the session and drops the push token, best effort. */
export async function signOut(): Promise<void> {
  const tokens = await session.get()
  await unregisterPush()
  if (tokens?.refreshToken)
    await api.post("/api/mobile/revoke", { token: tokens.refreshToken }).catch(() => {})
  await session.clear()
}

// However the session ends (sign-out, a revoked session, an expired refresh
// token), nothing of the last user stays: cached screens, queued writes, ids.
session.subscribe((tokens) => {
  if (tokens) return
  queryClient.clear()
  void outbox.clear()
  analytics.reset()
})
