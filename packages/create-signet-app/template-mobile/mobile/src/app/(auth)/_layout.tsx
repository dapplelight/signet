import { Stack } from "expo-router"
import { useTheme } from "@/lib/theme"

export default function AuthLayout() {
  const t = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: t.colors.background },
        headerTintColor: t.colors.foreground,
        contentStyle: { backgroundColor: t.colors.background },
      }}
    >
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="verify" options={{ title: "Enter the code" }} />
    </Stack>
  )
}
