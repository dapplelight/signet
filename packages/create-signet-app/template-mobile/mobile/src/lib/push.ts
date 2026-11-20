import * as Notifications from "expo-notifications"
import { type Href, router } from "expo-router"
import { useEffect, useState } from "react"
import { Linking, Platform } from "react-native"
import { api } from "./api"
import { EAS_PROJECT_ID } from "./config"
import { appStorage } from "./storage"

const TOKEN_KEY = "push-token"

// A notification that arrives while the app is open still shows.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

/** Screens a notification may open; anything else in a payload is ignored. */
const ROUTES = ["/", "/devices", "/settings"]

/** The screen a tapped notification's `data.url` points to, if it is one of ours. */
export function notificationHref(data: unknown): Href | null {
  const url = (data as { url?: unknown } | null | undefined)?.url
  if (typeof url !== "string") return null
  return ROUTES.some((r) => url === r || (r !== "/" && url.startsWith(`${r}/`)))
    ? (url as Href)
    : null
}

/**
 * Send this phone's Expo push token to the API. Asks for permission only when
 * `ask`; a phone that said no for good is sent to Settings instead.
 * Resolves whether notifications are on.
 */
export async function registerForPush(ask: boolean): Promise<boolean> {
  const perm = ask
    ? await Notifications.requestPermissionsAsync()
    : await Notifications.getPermissionsAsync()
  if (!perm.granted) {
    if (ask && !perm.canAskAgain) await Linking.openSettings()
    return false
  }
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "Notifications",
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : {},
  )
  if ((await appStorage.get(TOKEN_KEY)) !== token) {
    await api.post("/api/mobile/push/token", { token })
    await appStorage.set(TOKEN_KEY, token)
  }
  return true
}

/** On sign-out: the API stops pushing to this phone. Best effort. */
export async function unregisterPush(): Promise<void> {
  const token = await appStorage.get(TOKEN_KEY)
  if (!token) return
  await appStorage.remove(TOKEN_KEY)
  await api.delete("/api/mobile/push/token", { token }).catch(() => {})
}

/**
 * Signed-in only: re-send the token of a phone that already allowed
 * notifications (tokens change), and open the screen a tapped notification names.
 */
export function usePushRouting() {
  const last = Notifications.useLastNotificationResponse()
  useEffect(() => {
    registerForPush(false).catch(() => {}) // offline or a simulator: tried again next launch
  }, [])
  useEffect(() => {
    const href = notificationHref(last?.notification.request.content.data)
    if (href) router.push(href)
  }, [last])
}

/** For Settings: whether notifications are on (null while checking), and turning them on. */
export function usePushStatus() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    Notifications.getPermissionsAsync().then(
      (p) => setOn(p.granted),
      () => setOn(false),
    )
  }, [])
  return {
    on,
    enable: () => registerForPush(true).then(setOn, () => setOn(false)),
  }
}
