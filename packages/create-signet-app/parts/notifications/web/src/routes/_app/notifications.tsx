import {
  NotificationInbox,
  NotificationPreferences,
} from "@dapplelight/signet-ui/screens/notification-screens"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { api } from "../../lib/api"

export const Route = createFileRoute("/_app/notifications")({
  component: Notifications,
})

// Categories match the `category` of each template in api/services.ts.
const CATEGORIES = [
  { id: "account", label: "Account", description: "Sign-ins and profile changes" },
  { id: "billing", label: "Billing", description: "Plan changes and receipts", required: true }, // @payments
]

function Notifications() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const inbox = useInfiniteQuery({
    queryKey: ["notifications", "inbox"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (await api.notifications.$get({ query: pageParam ? { cursor: pageParam } : {} })).json(),
    getNextPageParam: (last) => last.nextCursor,
  })
  const prefs = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: async () => (await api.notifications.prefs.$get()).json(),
  }).data
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] })

  return (
    <div className="space-y-10">
      <NotificationInbox
        items={inbox.data?.pages.flatMap((p) => p.items) ?? []}
        unreadCount={inbox.data?.pages[0]?.unreadCount}
        hasMore={inbox.hasNextPage}
        onLoadMore={() => inbox.fetchNextPage()}
        onMarkRead={async (ids) => {
          await api.notifications.read.$post({ json: { ids } })
          await refresh()
        }}
        onMarkAllRead={async () => {
          await api.notifications["read-all"].$post()
          await refresh()
        }}
        onArchive={async (item) => {
          await api.notifications[":id"].archive.$post({ param: { id: item.id } })
          await refresh()
        }}
        onOpen={(item) => {
          if (item.link) navigate({ to: item.link })
        }}
      />
      {prefs ? (
        <NotificationPreferences
          categories={CATEGORIES}
          channels={["inApp", "email", "sms"]}
          defaultValue={prefs.channels}
          onToggle={async ({ category, channel, on }) => {
            await api.notifications.prefs.$put({
              json: { channels: { [category]: { [channel]: on } } },
            })
          }}
        />
      ) : null}
    </div>
  )
}
