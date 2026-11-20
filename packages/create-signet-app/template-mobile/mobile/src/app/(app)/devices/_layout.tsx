import { Stack } from "expo-router"
import { useTheme } from "@/lib/theme"

export default function DevicesLayout() {
  const t = useTheme()
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.background },
        headerTintColor: t.colors.foreground,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Devices" }} />
      <Stack.Screen name="[id]" options={{ title: "Device" }} />
    </Stack>
  )
}
