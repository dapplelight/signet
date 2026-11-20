import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Body, Button, Screen, StateView, TextField, Title } from "@/components/ui"
import { api, messageOf, type User } from "@/lib/api"
import { sendOrQueue, usePendingWrites } from "@/lib/outbox"

/** Home: who is signed in, and one write that works offline (your name). */
export default function Home() {
  const qc = useQueryClient()
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: User }>("/api/account/me").then((r) => r.user),
  })
  const pending = usePendingWrites()
  const [name, setName] = useState("")
  const [note, setNote] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (me.data?.name) setName(me.data.name)
  }, [me.data?.name])

  if (!me.data)
    return (
      <Screen>
        <StateView loading={me.isPending} error={me.error} onRetry={() => me.refetch()} />
      </Screen>
    )

  const save = async () => {
    const value = name.trim()
    if (!value) return setError("Enter a name.")
    setError(undefined)
    setBusy(true)
    try {
      const r = await sendOrQueue({
        method: "PATCH",
        path: "/api/account/me",
        body: { name: value },
      })
      setNote(r === "sent" ? "Saved." : "You are offline. It will be sent when you are back.")
      qc.setQueryData<User>(["me"], (u) => (u ? { ...u, name: value } : u))
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen form>
      <Title>{me.data.name ? `Hello, ${me.data.name}` : "Hello"}</Title>
      <Body muted>{`Signed in as ${me.data.phone}.`}</Body>
      <TextField
        label="Your name"
        value={name}
        onChangeText={setName}
        error={error}
        autoComplete="name"
        textContentType="name"
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <Button label="Save" onPress={save} loading={busy} />
      {note ? <Body muted>{note}</Body> : null}
      {pending ? <Body muted>{`${pending} change(s) waiting to be sent.`}</Body> : null}
    </Screen>
  )
}
