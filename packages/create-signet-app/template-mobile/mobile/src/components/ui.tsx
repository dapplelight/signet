import { errorCopy } from "@dapplelight/signet-lib/api"
import type { ReactNode } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native"
import { type Edge, SafeAreaView } from "react-native-safe-area-context"
import { useTheme } from "@/lib/theme"

/** The smallest comfortable touch target, in points (Apple's 44, Android's 48dp). */
export const TOUCH = 44

/**
 * A screen's background and padding inside the safe area. `form` scrolls and
 * moves up with the keyboard, so the focused field and its button stay visible.
 */
export function Screen({
  children,
  form,
  edges = ["bottom"],
}: {
  children: ReactNode
  form?: boolean
  edges?: Edge[]
}) {
  const t = useTheme()
  const body = { padding: t.spacing * 5, gap: t.spacing * 4 }
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.colors.background }}>
      {form ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[{ flex: 1 }, body]}>{children}</View>
      )}
    </SafeAreaView>
  )
}

export function Title({ children }: { children: ReactNode }) {
  const t = useTheme()
  return (
    <Text
      accessibilityRole="header"
      style={{ color: t.colors.foreground, fontSize: t.fontSize.xl, fontWeight: "600" }}
    >
      {children}
    </Text>
  )
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const t = useTheme()
  return (
    <Text
      style={{
        color: muted ? t.colors.mutedForeground : t.colors.foreground,
        fontSize: t.fontSize.base,
      }}
    >
      {children}
    </Text>
  )
}

export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  hint,
}: {
  label: string
  onPress: () => void
  variant?: "primary" | "secondary" | "destructive"
  loading?: boolean
  disabled?: boolean
  /** What happens on press, for screen readers, when the label alone does not say. */
  hint?: string
}) {
  const t = useTheme()
  const bg = {
    primary: t.colors.primary,
    secondary: t.colors.secondary,
    destructive: t.colors.destructive,
  }[variant]
  const fg = variant === "secondary" ? t.colors.secondaryForeground : t.colors.primaryForeground
  const off = disabled || loading
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH,
        borderRadius: t.radius.md,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: t.spacing * 4,
        opacity: off ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: t.fontSize.base, fontWeight: "600" }}>{label}</Text>
      )}
    </Pressable>
  )
}

export function TextField({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string | undefined }) {
  const t = useTheme()
  return (
    <View style={{ gap: t.spacing * 1.5 }}>
      <Text style={{ color: t.colors.foreground, fontSize: t.fontSize.sm, fontWeight: "500" }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error}
        placeholderTextColor={t.colors.mutedForeground}
        style={{
          minHeight: TOUCH,
          borderWidth: 1,
          borderColor: error ? t.colors.destructive : t.colors.input,
          borderRadius: t.radius.md,
          paddingHorizontal: t.spacing * 3,
          color: t.colors.foreground,
          backgroundColor: t.colors.card,
          fontSize: t.fontSize.base,
        }}
        {...input}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ color: t.colors.destructive }}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

/** A tappable row, at least one touch target tall. */
export function Row({
  title,
  detail,
  onPress,
  label,
}: {
  title: string
  detail?: string
  onPress?: () => void
  label?: string
}) {
  const t = useTheme()
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label ?? (detail ? `${title}, ${detail}` : title)}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH + 12,
        justifyContent: "center",
        paddingHorizontal: t.spacing * 4,
        paddingVertical: t.spacing * 2,
        backgroundColor: pressed ? t.colors.muted : t.colors.card,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
      })}
    >
      <Text style={{ color: t.colors.cardForeground, fontSize: t.fontSize.base }}>{title}</Text>
      {detail ? (
        <Text style={{ color: t.colors.mutedForeground, fontSize: t.fontSize.sm }}>{detail}</Text>
      ) : null}
    </Pressable>
  )
}

/** Loading, empty and error in one place, so every list says them the same way. */
export function StateView({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading?: boolean
  error?: unknown
  empty?: string
  onRetry?: () => void
}) {
  const t = useTheme()
  if (loading)
    return (
      <View style={{ padding: t.spacing * 8, alignItems: "center" }}>
        <ActivityIndicator accessibilityLabel="Loading" color={t.colors.primary} />
      </View>
    )
  const copy = error ? errorCopy((error as { code?: string }).code) : undefined
  return (
    <View style={{ padding: t.spacing * 8, gap: t.spacing * 3, alignItems: "center" }}>
      <Body muted={!copy}>{copy ? copy.title : empty}</Body>
      {copy ? <Body muted>{copy.detail}</Body> : null}
      {copy && onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  )
}
