// Signet's outbox and analytics call crypto.randomUUID, which Hermes lacks.
// expo-crypto supplies it in a development or store build; an Expo Go build
// without the ExpoCrypto native module falls back to Math.random.
// ponytail: Math.random v4 ids are fine for outbox and analytics ids, not for secrets.
const g = globalThis as { crypto?: { randomUUID?: () => string } }
g.crypto ??= {}
if (!g.crypto.randomUUID) {
  let native: (() => string) | undefined
  try {
    native = (require("expo-crypto") as { randomUUID: () => string }).randomUUID
  } catch {}
  g.crypto.randomUUID =
    native ??
    (() =>
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === "x" ? r : (r & 3) | 8).toString(16)
      }))
}
