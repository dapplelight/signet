import { createDateTimeFormatter } from "@dapplelight/signet-lib/format"
import { useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Body, Button, Screen, StateView, Title } from "@/components/ui"
import { api, messageOf } from "@/lib/api"
import { signOut } from "@/lib/auth"
import { relative, useDevices } from "@/lib/devices"

const dateTime = createDateTimeFormatter()

/** The sample detail: one device, and signing it out. */
export default function DeviceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const devices = useDevices()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const device = devices.data?.find((d) => d.id === id)

  if (!device)
    return (
      <Screen>
        <StateView
          loading={devices.isPending}
          error={devices.error}
          empty="This device is no longer signed in."
          onRetry={() => devices.refetch()}
        />
      </Screen>
    )

  const revoke = async () => {
    setBusy(true)
    try {
      if (device.current) return await signOut()
      await api.delete(`/api/sessions/${encodeURIComponent(device.id)}`)
      await qc.invalidateQueries({ queryKey: ["devices"] })
      router.back()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>{device.device}</Title>
      {device.current ? <Body muted>This phone.</Body> : null}
      <Body>{`Signed in ${dateTime(device.createdAt)}`}</Body>
      <Body>{`Last active ${relative(device.lastSeenAt)}`}</Body>
      {device.ip ? <Body muted>{`From ${device.ip}`}</Body> : null}
      <Button
        label={device.current ? "Sign out" : "Sign this device out"}
        variant="destructive"
        onPress={revoke}
        loading={busy}
      />
      {error ? <Body>{error}</Body> : null}
    </Screen>
  )
}
