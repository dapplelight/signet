import { THEME_NAMES } from "@dapplelight/signet-tokens/native"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Body, Button, Screen, TOUCH } from "@/components/ui"
import { api, messageOf } from "@/lib/api"
import { signOut } from "@/lib/auth"
import { APP_VERSION } from "@/lib/config"
import { usePushStatus } from "@/lib/push"
import { APPEARANCES, useTheme } from "@/lib/theme"

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** One choice of several, as a row of buttons; screen readers hear it as radio buttons. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
}) {
  const t = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: t.spacing * 2 }}>
      <Text style={{ color: t.colors.foreground, fontSize: t.fontSize.sm, fontWeight: "500" }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing * 2 }}>
        {options.map((o) => {
          const on = o === value
          return (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityLabel={capital(o)}
              accessibilityState={{ selected: on }}
              onPress={() => onChange(o)}
              style={{
                minHeight: TOUCH,
                minWidth: TOUCH,
                paddingHorizontal: t.spacing * 4,
                justifyContent: "center",
                borderRadius: t.radius.md,
                borderWidth: 1,
                borderColor: on ? t.colors.primary : t.colors.border,
                backgroundColor: on ? t.colors.accent : t.colors.card,
              }}
            >
              <Text style={{ color: on ? t.colors.accentForeground : t.colors.cardForeground }}>
                {capital(o)}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export default function Settings() {
  const t = useTheme()
  const push = usePushStatus()
  const [note, setNote] = useState<string>()
  const [busy, setBusy] = useState(false)

  const testPush = async () => {
    try {
      await api.post("/api/mobile/push/test")
      setNote("Sent. It should arrive in a few seconds.")
    } catch (e) {
      setNote(messageOf(e))
    }
  }

  return (
    <Screen form>
      <Choice
        label="Theme"
        options={THEME_NAMES}
        value={t.prefs.theme}
        onChange={(theme) => t.setPrefs({ theme })}
      />
      <Choice
        label="Appearance"
        options={APPEARANCES}
        value={t.prefs.appearance}
        onChange={(appearance) => t.setPrefs({ appearance })}
      />
      {push.on === false ? (
        <Button
          label="Turn on notifications"
          variant="secondary"
          onPress={push.enable}
          hint="Asks for permission to send notifications"
        />
      ) : null}
      {push.on ? (
        <Button label="Send a test notification" variant="secondary" onPress={testPush} />
      ) : null}
      {note ? <Body muted>{note}</Body> : null}
      <Button
        label="Sign out"
        variant="destructive"
        loading={busy}
        onPress={() => {
          setBusy(true)
          void signOut()
        }}
      />
      <Body muted>{`Version ${APP_VERSION}`}</Body>
    </Screen>
  )
}
