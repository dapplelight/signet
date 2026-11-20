import { useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Body, Button, Screen, TextField } from "@/components/ui"
import { messageOf } from "@/lib/api"
import { requestCode, verifyCode } from "@/lib/auth"

export default function Verify() {
  const { phone = "", to = "" } = useLocalSearchParams<{ phone: string; to: string }>()
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)

  const submit = async () => {
    if (!/^\d{4,8}$/.test(code)) return setError("Enter the code from the text message.")
    setError(undefined)
    setBusy(true)
    try {
      // On success the session is set and the auth gate swaps in the app.
      await verifyCode(phone, code)
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  const resend = async () => {
    setError(undefined)
    try {
      await requestCode(phone)
      setResent(true)
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <Screen form>
      <Body muted>{`We sent a code to ${to || phone}.`}</Body>
      <TextField
        label="Code"
        value={code}
        onChangeText={setCode}
        error={error}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={8}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Button label="Sign in" onPress={submit} loading={busy} />
      <Button
        label={resent ? "Code sent again" : "Send a new code"}
        variant="secondary"
        onPress={resend}
        disabled={resent}
      />
    </Screen>
  )
}
