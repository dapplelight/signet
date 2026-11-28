import { ErrorState } from "@dapplelight/signet-ui/components/error-state"
import { Skeleton } from "@dapplelight/signet-ui/components/skeleton"
import {
  NotificationInbox,
  NotificationPreferences,
} from "@dapplelight/signet-ui/screens/notification-screens"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { ApiError, api } from "../../lib/api"

export const Route = createFileRoute("/_app/notifications")({
  component: Notifications,
})

// Categories match the `category` of each template in api/services.ts.
const CATEGORIES = [
  { id: "account", label: "Account", description: "Sign-ins and profile changes" },
  { id: "billing", label: "Billing", description: "Plan changes and receipts", required: true }, // @payments
]

const SURFACE = "rounded-xl bg-bg-surface p-2 ring-1 ring-foreground/10"

/** Toast the ApiError's message, else the fallback. */
const fail = (e: unknown, fallback: string) =>
  toast.error(e instanceof ApiError && e.message ? e.message : fallback)

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
  const prefsQuery = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: async () => (await api.notifications.prefs.$get()).json(),
  })
  const prefs = prefsQuery.data
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] })
  // Toast, then swallow: the inbox's inline line stays empty, so the user sees one message.
  const act = async (fallback: string, run: () => Promise<unknown>) => {
    try {
      await run()
      await refresh()
    } catch (e) {
      fail(e, fallback)
    }
  }

  let inboxView: ReactNode
  if (inbox.isPending) {
    inboxView = (
      <div
        data-state="loading"
        role="status"
        aria-label="Loading notifications"
        className={`flex flex-col gap-2 ${SURFACE}`}
      >
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    )
  } else if (inbox.isError) {
    inboxView = (
      <div data-state="error" className={SURFACE}>
        <ErrorState message="Your notifications did not load." onRetry={() => inbox.refetch()} />
      </div>
    )
  } else {
    inboxView = (
      <NotificationInbox
        items={inbox.data.pages.flatMap((p) => p.items)}
        unreadCount={inbox.data.pages[0]?.unreadCount}
        hasMore={inbox.hasNextPage}
        onLoadMore={async () => {
          try {
            await inbox.fetchNextPage({ throwOnError: true })
          } catch (e) {
            fail(e, "Couldn't load more notifications.")
          }
        }}
        onMarkRead={(ids) =>
          act("Couldn't mark as read.", () => api.notifications.read.$post({ json: { ids } }))
        }
        onMarkAllRead={() =>
          act("Couldn't mark all as read.", () => api.notifications["read-all"].$post())
        }
        onArchive={(item) =>
          act("Couldn't archive that notification.", () =>
            api.notifications[":id"].archive.$post({ param: { id: item.id } }),
          )
        }
        onOpen={(item) => {
          if (item.link) navigate({ to: item.link })
        }}
      />
    )
  }

  return (
    <div className="space-y-10" aria-busy={inbox.isPending || prefsQuery.isPending || undefined}>
      {inboxView}
      {prefsQuery.isPending ? (
        <div data-state="loading" role="status" aria-label="Loading notification settings">
          <Skeleton className="h-40" />
        </div>
      ) : prefsQuery.isError ? (
        <div data-state="error" className={SURFACE}>
          <ErrorState
            message="Your notification settings did not load."
            onRetry={() => prefsQuery.refetch()}
          />
        </div>
      ) : prefs ? (
        <NotificationPreferences
          categories={CATEGORIES}
          channels={["inApp", "email", "sms"]}
          defaultValue={prefs.channels}
          onToggle={async ({ category, channel, on }) => {
            try {
              await api.notifications.prefs.$put({
                json: { channels: { [category]: { [channel]: on } } },
              })
            } catch (e) {
              fail(e, "Couldn't save that setting.")
              throw e // rethrow: the switch flips back
            }
          }}
        />
      ) : null}
    </div>
  )
}
