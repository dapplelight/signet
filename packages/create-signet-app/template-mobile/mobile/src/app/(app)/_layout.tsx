import Ionicons from "@expo/vector-icons/Ionicons"
import { Tabs } from "expo-router"
import type { ComponentProps } from "react"
import type { ColorValue } from "react-native"
import { useOutboxFlush } from "@/lib/outbox"
import { usePushRouting } from "@/lib/push"
import { useTheme } from "@/lib/theme"

type Icon = ComponentProps<typeof Ionicons>["name"]
const icon =
  (name: Icon) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    // The tab bar passes the tint colours set below, which are token strings.
    <Ionicons name={name} color={String(color)} size={size} />
  )

/** Signed in: the tabs, plus what only runs for a signed-in phone (push, the outbox). */
export default function AppLayout() {
  const t = useTheme()
  usePushRouting()
  useOutboxFlush()
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.background },
        headerTintColor: t.colors.foreground,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.colors.card, borderTopColor: t.colors.border },
        tabBarActiveTintColor: t.colors.primary,
        tabBarInactiveTintColor: t.colors.mutedForeground,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen
        name="devices"
        options={{
          title: "Devices",
          headerShown: false,
          tabBarIcon: icon("phone-portrait-outline"),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: icon("settings-outline") }}
      />
    </Tabs>
  )
}
