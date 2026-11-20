import { randomUUID } from "expo-crypto"

// Signet's outbox and analytics call crypto.randomUUID, which Hermes lacks.
const g = globalThis as { crypto?: { randomUUID?: () => string } }
g.crypto ??= {}
g.crypto.randomUUID ??= randomUUID
