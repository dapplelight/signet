#!/usr/bin/env bun

import { parseArgs } from "node:util"
import { createApiClient } from "@dapplelight/signet-lib/api"
import {
  createSession,
  fromTokenResponse,
  tokenEndpointRefresh,
} from "@dapplelight/signet-lib/session"
import { fileStorage } from "@dapplelight/signet-lib/storage/file"
import { AUTH_PATH, CLIENT_ID, DEFAULT_API_URL, sessionPath, WHOAMI_PATH } from "./config.ts"
import { pollDeviceToken } from "./poll.ts"
import { dim, fail, link, ok } from "./ui.ts"

const HELP = `__APP_NAME__ <command>

Commands:
  login     Sign in: shows a code to approve in your browser
  logout    Revoke this device's session and forget it
  whoami    Show the signed-in user

Options:
  --api-url <url>   API base URL (default: $API_URL or ${DEFAULT_API_URL})
  -h, --help
`

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "api-url": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  })
  const command = positionals[0]
  if (values.help || !command) {
    console.log(HELP)
    return
  }

  const apiUrl = (values["api-url"] ?? process.env.API_URL ?? DEFAULT_API_URL).replace(/\/$/, "")
  const authUrl = `${apiUrl}${AUTH_PATH}`
  const session = createSession({
    storage: fileStorage(sessionPath()),
    refresh: tokenEndpointRefresh(`${authUrl}/token`, CLIENT_ID),
  })
  const api = createApiClient({
    baseUrl: apiUrl,
    token: session.token,
    refresh: session.refresh,
    credentials: "omit",
  })

  if (command === "login") {
    const res = await fetch(`${authUrl}/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    })
    if (!res.ok) throw new Error(`Could not start sign-in (HTTP ${res.status})`)
    const d = (await res.json()) as {
      device_code: string
      user_code: string
      verification_uri_complete: string
      expires_in: number
      interval: number
    }
    console.log(
      `Your code is ${ok(d.user_code)}\nApprove it at ${link(d.verification_uri_complete)}`,
    )
    console.log(dim("Waiting for approval..."))
    const tokens = await pollDeviceToken({
      tokenUrl: `${authUrl}/token`,
      clientId: CLIENT_ID,
      deviceCode: d.device_code,
      interval: d.interval,
      expiresIn: d.expires_in,
    })
    await session.set(fromTokenResponse(tokens))
    console.log(ok("Signed in."))
  } else if (command === "logout") {
    const t = await session.get()
    // The server revokes either token and always answers 200; the local copy goes regardless.
    for (const token of [t?.refreshToken, t?.accessToken])
      if (token)
        await fetch(`${authUrl}/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }).catch(() => {})
    await session.clear()
    console.log(ok("Signed out."))
  } else if (command === "whoami") {
    if (!(await session.get())) throw new Error("Not signed in. Run login.")
    console.log(JSON.stringify(await api.get(WHOAMI_PATH), null, 2))
  } else {
    throw new Error(`Unknown command "${command}".\n\n${HELP}`)
  }
}

main().catch((err: unknown) => {
  console.error(fail(err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
