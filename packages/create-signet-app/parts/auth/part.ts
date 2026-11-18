import type { Part } from "../../src/compose.js"

/** A fresh 48-character secret for the generated env file. */
const secret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(36))).toString("base64url")

export default {
  description: "phone one-time-code sign-in, stored sessions, the login page",
  // AuthScreen's code input.
  web: { deps: { "input-otp": "^1.4.2" } },
  // The browser smoke test: sign in, then each page the app has.
  both: {
    devDeps: { "@playwright/test": "^1.65.1" },
    scripts: { "test:e2e": "playwright test" },
  },
  env: () => [
    `SESSION_SECRET=${secret()}`,
    `OTP_SECRET=${secret()}`,
    "# Phone numbers (E.164, comma-separated) that become admins on sign-in.",
    "ADMIN_PHONES=",
  ],
  tables: ["users"],
} satisfies Part
