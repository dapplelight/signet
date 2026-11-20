import { router } from "expo-router"
import { useState } from "react"
import { Body, Button, Screen, TextField, Title } from "@/components/ui"
import { messageOf } from "@/lib/api"
import { requestCode } from "@/lib/auth"

/** Digits with an optional leading +, 6 to 15 of them: the server normalises the rest. */
const PHONE = /^\+?\d{6,15}$/

export default function SignIn() {
  const [phone, setPhone] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const value = phone.replace(/[\s()-]/g, "")
    if (!PHONE.test(value)) return setError("Enter your phone number with its country code.")
    setError(undefined)
    setBusy(true)
    try {
      const to = await requestCode(value)
      router.push({ pathname: "/verify", params: { phone: value, to } })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen form edges={["top", "bottom"]}>
      <Title>Sign in</Title>
      <Body muted>We will text you a code. No password needed.</Body>
      <TextField
        label="Phone number"
        placeholder="+1 555 010 0199"
        value={phone}
        onChangeText={setPhone}
        error={error}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      <Button label="Send code" onPress={submit} loading={busy} />
    </Screen>
  )
}
