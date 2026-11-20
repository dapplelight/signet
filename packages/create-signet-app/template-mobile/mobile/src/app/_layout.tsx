import "@/lib/polyfills"
import { nativeTheme } from "@dapplelight/signet-tokens/native"
import { QueryClientProvider } from "@tanstack/react-query"
import { type ErrorBoundaryProps, Stack } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { Pressable, Text, useColorScheme, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useScreenViews } from "@/lib/analytics"
import { queryClient } from "@/lib/api"
import "@/lib/auth"
import { useSession } from "@/lib/session"
import { DEFAULT_THEME, ThemeProvider, useTheme } from "@/lib/theme"

void SplashScreen.preventAutoHideAsync().catch(() => {})

/**
 * The auth gate: signed in, the (app) tabs; signed out, (auth). A session
 * that ends anywhere (sign-out, a 401 the refresh could not fix) lands on
 * sign-in, because the guard flips.
 */
function Gate() {
  const tokens = useSession()
  const t = useTheme()
  useScreenViews()
  const ready = tokens !== undefined
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {})
  }, [ready])
  if (!ready) return null
  return (
    <>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.colors.background },
        }}
      >
        {/* Name where each side lands: (auth) has no index of its own. */}
        <Stack.Protected guard={!!tokens} redirectTo="/sign-in">
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!tokens} redirectTo="/">
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  )
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Gate />
      </ThemeProvider>
    </QueryClientProvider>
  )
}

/** Shown in place of any screen that throws while rendering. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = nativeTheme(DEFAULT_THEME, useColorScheme())
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16 }}>
        <Text
          accessibilityRole="header"
          style={{ color: t.colors.foreground, fontSize: t.fontSize.xl, fontWeight: "600" }}
        >
          Something went wrong
        </Text>
        <Text style={{ color: t.colors.mutedForeground, fontSize: t.fontSize.base }}>
          {__DEV__ ? error.message : "This screen hit a problem. Try again."}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={retry}
          style={{
            minHeight: 44,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: t.colors.primaryForeground, fontWeight: "600" }}>Try again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
