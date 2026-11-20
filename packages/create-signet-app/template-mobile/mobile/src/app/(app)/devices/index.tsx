import { router } from "expo-router"
import { FlatList, RefreshControl } from "react-native"
import { Row, StateView } from "@/components/ui"
import { relative, useDevices } from "@/lib/devices"
import { useTheme } from "@/lib/theme"

/** The sample list: pull to refresh, with loading, empty and error states. */
export default function Devices() {
  const t = useTheme()
  const devices = useDevices()
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: t.colors.background }}
      data={devices.data ?? []}
      keyExtractor={(d) => d.id}
      refreshControl={
        <RefreshControl
          refreshing={devices.isRefetching}
          onRefresh={() => void devices.refetch()}
          tintColor={t.colors.primary}
        />
      }
      ListEmptyComponent={
        <StateView
          loading={devices.isPending}
          error={devices.error}
          empty="No devices yet."
          onRetry={() => devices.refetch()}
        />
      }
      renderItem={({ item }) => (
        <Row
          title={item.current ? `${item.device} (this phone)` : item.device}
          detail={`Active ${relative(item.lastSeenAt)}`}
          onPress={() => router.push({ pathname: "/devices/[id]", params: { id: item.id } })}
        />
      )}
    />
  )
}
