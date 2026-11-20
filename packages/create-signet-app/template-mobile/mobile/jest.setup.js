// The native modules the app touches, as in-memory stand-ins: tests run in Node.
jest.mock("expo-secure-store", () => {
  const m = new Map()
  return {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => void m.set(k, v),
    deleteItemAsync: async (k) => void m.delete(k),
  }
})
jest.mock("expo-sqlite/kv-store", () => {
  const m = new Map()
  return {
    __esModule: true,
    default: {
      getItem: async (k) => m.get(k) ?? null,
      setItem: async (k, v) => void m.set(k, v),
      removeItem: async (k) => void m.delete(k),
    },
  }
})
jest.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove() {} }),
}))
jest.mock("expo-notifications", () => ({
  setNotificationHandler: () => {},
  useLastNotificationResponse: () => null,
  getPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
  requestPermissionsAsync: async () => ({ granted: false, canAskAgain: true }),
  setNotificationChannelAsync: async () => {},
  getExpoPushTokenAsync: async () => ({ data: "ExponentPushToken[test]" }),
  AndroidImportance: { DEFAULT: 3 },
}))
