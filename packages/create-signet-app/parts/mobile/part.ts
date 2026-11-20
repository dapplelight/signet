import type { Part } from "../../src/compose.js"

export default {
  description: "the mobile app's API: token sign-in, refresh, Expo push tokens",
  needs: ["auth"],
  apiOnly: true,
  env: () => [
    "# Expo push: an access token, once push security is on in your Expo project.",
    "EXPO_ACCESS_TOKEN=",
  ],
} satisfies Part
