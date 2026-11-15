"use client"

// Account screens: a profile card, the "your devices" session list with sign
// out and sign out everywhere else, and an API-key manager whose new key is
// shown once. Plain data in, callbacks out: rows match signet-server's
// `sessionRoutes` GET and `listApiKeys`; wire the callbacks through
// `createRpcClient`. Destructive actions confirm first.
// Recipe: popup + focus-trap + dismiss + field-wiring + image-loading + live-region
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  LaptopIcon,
  LogOutIcon,
  PlusIcon,
  SmartphoneIcon,
  TrashIcon,
} from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog.js"
import { Avatar, AvatarFallback, AvatarImage, initials } from "../ui/avatar.js"
import { Badge } from "../ui/badge.js"
import { Button } from "../ui/button.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js"
import { Field, FieldControl, FieldLabel } from "../ui/field.js"
import { Input } from "../ui/input.js"
import { Spinner } from "../ui/spinner.js"

/** Epoch ms, an ISO string, or a Date: what JSON and the stores hand back. */
export type When = number | string | Date

/** One row of signet-server's `sessionRoutes` GET. */
export type SessionRow = {
  id: string
  /** "Chrome on macOS". */
  device: string
  ip?: string | null
  createdAt?: When
  lastSeenAt: When
  expiresAt?: When
  /** The session making this request. */
  current?: boolean
}

/** signet-server's `ApiKeyInfo`: never the secret. */
export type ApiKeyRow = {
  id: string
  name: string
  /** The token's first characters, `app_1a2b3c`. */
  start: string
  scopes?: string[]
  createdAt: When
  expiresAt?: When | null
  lastUsedAt?: When | null
}

export type Profile = {
  name?: string | null
  email?: string | null
  phone?: string | null
  image?: string | null
}

/** Every string the account screens show. Spread it and override what you need. */
export const DEFAULT_ACCOUNT_LABELS = {
  profile: "Profile",
  name: "Name",
  email: "Email",
  phone: "Phone",
  save: "Save",
  sessions: "Devices",
  thisDevice: "This device",
  signOut: "Sign out",
  signOutDevice: (device: string) => `Sign out ${device}`,
  signOutOthers: "Sign out others",
  signOutOthersTitle: "Sign out every other device?",
  apiKeys: "API keys",
  newKey: "New key",
  keyName: "Key name",
  keyNamePlaceholder: "CI deploy",
  create: "Create",
  cancel: "Cancel",
  keyCreated: "Copy your key",
  keyOnce: "You won't see it again.",
  copy: "Copy",
  copied: "Copied",
  done: "Done",
  revoke: "Revoke",
  revokeKey: (name: string) => `Revoke ${name}`,
  revokeTitle: (name: string) => `Revoke ${name}?`,
  noKeys: "No keys yet",
  lastUsed: (when: string) => `Used ${when}`,
  neverUsed: "Never used",
  active: (when: string) => `Active ${when}`,
  justNow: "just now",
  error: "Something went wrong. Try again.",
}

export type AccountLabels = typeof DEFAULT_ACCOUNT_LABELS

const toDate = (w: When) => (w instanceof Date ? w : new Date(w))

/** "3 hours ago", in the browser's language unless `locale` says otherwise. */
function ago(w: When, justNow: string, locale?: string, now = Date.now()): string {
  const s = Math.round((toDate(w).getTime() - now) / 1000)
  if (Math.abs(s) < 60) return justNow
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  for (const [unit, size] of [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit)
  }
  return justNow
}

/** Runs an async callback, tracking pending and the thrown message. */
function useAction<A extends unknown[], R>(fn: ((...args: A) => R) | undefined, fallback: string) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = async (...args: A): Promise<{ ok: true; value: Awaited<R> } | { ok: false }> => {
    if (!fn) return { ok: false }
    setPending(true)
    setError(null)
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : fallback)
      return { ok: false }
    } finally {
      setPending(false)
    }
  }
  return { pending, error, run }
}

// --- shared parts ------------------------------------------------------------

/** A titled section card. `render` swaps its element (a `<section>` by default). */
function AccountSection({ className, render, ...props }: useRender.ComponentProps<"section">) {
  return useRender({
    defaultTagName: "section",
    render,
    props: mergeProps<"section">(
      {
        className: cn(
          "flex flex-col gap-4 rounded-xl bg-bg-surface p-4 text-sm text-text-primary ring-1 ring-foreground/10",
          className,
        ),
      },
      props,
    ),
    state: { slot: "account-section" },
  })
}

function AccountSectionHeader({
  title,
  action,
  id,
  className,
}: {
  title: React.ReactNode
  action?: React.ReactNode
  id?: string
  className?: string
}) {
  return (
    <div
      data-slot="account-section-header"
      className={cn("flex min-h-8 items-center justify-between gap-2", className)}
    >
      <h2 id={id} className="text-base leading-none font-medium">
        {title}
      </h2>
      {action}
    </div>
  )
}

function ErrorLine({ children }: { children?: React.ReactNode }) {
  return (
    <p role="alert" data-slot="account-error" className="text-sm text-destructive empty:hidden">
      {children}
    </p>
  )
}

/** A confirm-first destructive button. */
function ConfirmButton({
  title,
  confirm,
  cancel,
  onConfirm,
  trigger,
  children,
}: {
  children: React.ReactNode
  title: string
  confirm: string
  cancel: string
  onConfirm: () => unknown
  trigger: React.ReactElement<Record<string, unknown>>
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={trigger}>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" action={async () => void (await onConfirm())}>
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// --- profile -----------------------------------------------------------------

type ProfileCardProps = {
  profile: Profile
  /** Save a new name. Without it the name is read-only. */
  onSave?: (patch: { name: string }) => unknown
  /** Shown beside the details, e.g. a "Change photo" upload button. */
  action?: React.ReactNode
  labels?: Partial<AccountLabels>
  className?: string
  classNames?: Partial<Record<"avatar" | "details" | "form", string>>
}

/** Avatar, name (editable with `onSave`), and the verified email and phone. */
function ProfileCard({
  profile,
  onSave,
  action,
  labels,
  className,
  classNames = {},
}: ProfileCardProps) {
  const l = { ...DEFAULT_ACCOUNT_LABELS, ...labels }
  const [name, setName] = React.useState(profile.name ?? "")
  React.useEffect(() => setName(profile.name ?? ""), [profile.name])
  const save = useAction(onSave, l.error)
  const dirty = name.trim() !== (profile.name ?? "") && name.trim() !== ""
  const id = React.useId()
  return (
    <AccountSection aria-labelledby={id} className={className}>
      <h2 id={id} className="sr-only">
        {l.profile}
      </h2>
      <div className="flex items-center gap-4">
        <Avatar size="lg" className={cn("size-14 text-lg", classNames.avatar)}>
          {profile.image ? <AvatarImage src={profile.image} alt="" /> : null}
          <AvatarFallback>{initials(profile.name ?? profile.email ?? "?")}</AvatarFallback>
        </Avatar>
        <dl data-slot="profile-details" className={cn("grid min-w-0 gap-0.5", classNames.details)}>
          <dt className="sr-only">{l.name}</dt>
          <dd className="truncate text-base font-medium">{profile.name || profile.email}</dd>
          {profile.email ? (
            <>
              <dt className="sr-only">{l.email}</dt>
              <dd className="truncate text-text-muted">{profile.email}</dd>
            </>
          ) : null}
          {profile.phone ? (
            <>
              <dt className="sr-only">{l.phone}</dt>
              <dd className="truncate text-text-muted tabular-nums">{profile.phone}</dd>
            </>
          ) : null}
        </dl>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {onSave ? (
        <form
          data-slot="profile-form"
          className={cn("flex items-end gap-2", classNames.form)}
          onSubmit={(e) => {
            e.preventDefault()
            if (dirty) void save.run({ name: name.trim() })
          }}
        >
          <Field className="flex-1" invalid={save.error ? true : undefined}>
            <FieldLabel>{l.name}</FieldLabel>
            <FieldControl
              autoComplete="name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!dirty || save.pending}>
            {save.pending ? <Spinner aria-label={l.save} /> : null}
            {l.save}
          </Button>
        </form>
      ) : null}
      <ErrorLine>{save.error}</ErrorLine>
    </AccountSection>
  )
}

// --- sessions ----------------------------------------------------------------

const PHONE = /iphone|ipad|android|ios|mobile/i

type SessionItemProps = Omit<React.ComponentProps<"li">, "children"> & {
  session: SessionRow
  onRevoke?: (session: SessionRow) => unknown
  labels?: Partial<AccountLabels>
  locale?: string
}

function SessionItem({ session, onRevoke, labels, locale, className, ...props }: SessionItemProps) {
  const l = { ...DEFAULT_ACCOUNT_LABELS, ...labels }
  const revoke = useAction(onRevoke, l.error)
  const Icon = PHONE.test(session.device) ? SmartphoneIcon : LaptopIcon
  return (
    <li
      data-slot="session-item"
      data-current={session.current ? "" : undefined}
      className={cn("flex items-center gap-3 py-3 first:pt-0 last:pb-0", className)}
      {...props}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-text-secondary">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-center gap-2 truncate font-medium">
          {session.device}
          {session.current ? <Badge variant="secondary">{l.thisDevice}</Badge> : null}
        </span>
        <span className="truncate text-xs text-text-muted">
          {[session.ip, l.active(ago(session.lastSeenAt, l.justNow, locale))]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <ErrorLine>{revoke.error}</ErrorLine>
      </div>
      {onRevoke && !session.current ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={l.signOutDevice(session.device)}
          disabled={revoke.pending}
          onClick={() => void revoke.run(session)}
        >
          {revoke.pending ? <Spinner /> : <LogOutIcon />}
        </Button>
      ) : null}
    </li>
  )
}

type SessionsListProps = {
  sessions: readonly SessionRow[]
  /** Sign out one other device (`DELETE /:id`). */
  onRevoke?: (session: SessionRow) => unknown
  /** Sign out everywhere else (`POST /revoke-others`). Confirms first. */
  onRevokeOthers?: () => unknown
  /** For relative times. Default the browser's. */
  locale?: string
  labels?: Partial<AccountLabels>
  className?: string
  classNames?: Partial<Record<"header" | "list" | "item", string>>
}

/** Where you're signed in, newest activity first, with sign out per device and for all others. */
function SessionsList({
  sessions,
  onRevoke,
  onRevokeOthers,
  locale,
  labels,
  className,
  classNames = {},
}: SessionsListProps) {
  const l = { ...DEFAULT_ACCOUNT_LABELS, ...labels }
  const others = sessions.some((s) => !s.current)
  const [error, setError] = React.useState<string | null>(null)
  const id = React.useId()
  return (
    <AccountSection aria-labelledby={id} className={className}>
      <AccountSectionHeader
        id={id}
        title={l.sessions}
        className={classNames.header}
        action={
          onRevokeOthers && others ? (
            <ConfirmButton
              title={l.signOutOthersTitle}
              confirm={l.signOutOthers}
              cancel={l.cancel}
              onConfirm={async () => {
                setError(null)
                try {
                  await onRevokeOthers()
                } catch (e) {
                  setError(e instanceof Error && e.message ? e.message : l.error)
                }
              }}
              trigger={<Button variant="outline" size="sm" />}
            >
              {l.signOutOthers}
            </ConfirmButton>
          ) : null
        }
      />
      <ul data-slot="session-list" className={cn("divide-y divide-border", classNames.list)}>
        {sessions.map((s) => (
          <SessionItem
            key={s.id}
            session={s}
            onRevoke={onRevoke}
            labels={labels}
            locale={locale}
            className={classNames.item}
          />
        ))}
      </ul>
      <ErrorLine>{error}</ErrorLine>
    </AccountSection>
  )
}

// --- api keys ----------------------------------------------------------------

/** The new key, once: read-only, selected on focus, with a copy button. */
function ApiKeyReveal({
  token,
  labels,
  className,
}: {
  token: string
  labels?: Partial<AccountLabels>
  className?: string
}) {
  const l = { ...DEFAULT_ACCOUNT_LABELS, ...labels }
  const [copied, setCopied] = React.useState(false)
  return (
    <div data-slot="api-key-reveal" className={cn("flex gap-2", className)}>
      <Input
        readOnly
        value={token}
        aria-label={l.keyCreated}
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-xs"
      />
      <Button
        type="button"
        variant="outline"
        data-copied={copied ? "" : undefined}
        onClick={async () => {
          await navigator.clipboard?.writeText(token)
          setCopied(true)
        }}
      >
        {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        <span aria-live="polite">{copied ? l.copied : l.copy}</span>
      </Button>
    </div>
  )
}

type ApiKeysManagerProps = {
  keys: readonly ApiKeyRow[]
  /** Mint a key (`createApiKey`). Return the token: it is shown once, then dropped. */
  onCreate?: (input: { name: string }) => Promise<{ token: string }> | { token: string }
  /** Revoke a key (`revokeApiKey`). Confirms first. */
  onRevoke?: (key: ApiKeyRow) => unknown
  locale?: string
  labels?: Partial<AccountLabels>
  className?: string
  classNames?: Partial<Record<"header" | "list" | "item" | "empty" | "dialog", string>>
}

/** Your API keys: create (the secret shows once), see when each was used, revoke. */
function ApiKeysManager({
  keys,
  onCreate,
  onRevoke,
  locale,
  labels,
  className,
  classNames = {},
}: ApiKeysManagerProps) {
  const l = { ...DEFAULT_ACCOUNT_LABELS, ...labels }
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [token, setToken] = React.useState<string | null>(null)
  const create = useAction(onCreate, l.error)
  const revoke = useAction(onRevoke, l.error)
  const id = React.useId()
  const close = (next: boolean) => {
    setOpen(next)
    if (!next) {
      // The secret leaves memory with the dialog.
      setToken(null)
      setName("")
    }
  }
  return (
    <AccountSection aria-labelledby={id} className={className}>
      <AccountSectionHeader
        id={id}
        title={l.apiKeys}
        className={classNames.header}
        action={
          onCreate ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <PlusIcon aria-hidden />
              {l.newKey}
            </Button>
          ) : null
        }
      />
      {keys.length ? (
        <ul data-slot="api-key-list" className={cn("divide-y divide-border", classNames.list)}>
          {keys.map((k) => (
            <li
              key={k.id}
              data-slot="api-key-item"
              data-expired={
                k.expiresAt && toDate(k.expiresAt).getTime() < Date.now() ? "" : undefined
              }
              className={cn(
                "flex items-center gap-3 py-3 first:pt-0 last:pb-0 data-expired:opacity-60",
                classNames.item,
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-text-secondary">
                <KeyRoundIcon aria-hidden className="size-4" />
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{k.name}</span>
                <span className="truncate text-xs text-text-muted">
                  <code className="font-mono">{k.start}…</code>
                  {" · "}
                  {k.lastUsedAt ? l.lastUsed(ago(k.lastUsedAt, l.justNow, locale)) : l.neverUsed}
                </span>
              </div>
              {onRevoke ? (
                <ConfirmButton
                  title={l.revokeTitle(k.name)}
                  confirm={l.revoke}
                  cancel={l.cancel}
                  onConfirm={() => revoke.run(k)}
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label={l.revokeKey(k.name)} />
                  }
                >
                  <TrashIcon />
                </ConfirmButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div
          data-slot="api-key-empty"
          className={cn(
            "flex flex-col items-center gap-2 py-6 text-text-muted [&_svg]:size-6 [&_svg]:text-text-hint",
            classNames.empty,
          )}
        >
          <KeyRoundIcon aria-hidden />
          {l.noKeys}
        </div>
      )}
      <ErrorLine>{revoke.error}</ErrorLine>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent showCloseButton={false} className={classNames.dialog}>
          {token ? (
            <>
              <DialogHeader>
                <DialogTitle>{l.keyCreated}</DialogTitle>
                <DialogDescription>{l.keyOnce}</DialogDescription>
              </DialogHeader>
              <ApiKeyReveal token={token} labels={labels} />
              <DialogFooter>
                <Button onClick={() => close(false)}>{l.done}</Button>
              </DialogFooter>
            </>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!name.trim()) return
                const r = await create.run({ name: name.trim() })
                if (r.ok) setToken(r.value.token)
              }}
            >
              <DialogHeader>
                <DialogTitle>{l.newKey}</DialogTitle>
              </DialogHeader>
              <Field invalid={create.error ? true : undefined}>
                <FieldLabel>{l.keyName}</FieldLabel>
                <FieldControl
                  autoFocus
                  maxLength={100}
                  placeholder={l.keyNamePlaceholder}
                  value={name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                />
              </Field>
              <ErrorLine>{create.error}</ErrorLine>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => close(false)}>
                  {l.cancel}
                </Button>
                <Button type="submit" disabled={!name.trim() || create.pending}>
                  {create.pending ? <Spinner aria-label={l.create} /> : null}
                  {l.create}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </AccountSection>
  )
}

export type { ApiKeysManagerProps, ProfileCardProps, SessionItemProps, SessionsListProps }
export {
  AccountSection,
  AccountSectionHeader,
  ApiKeyReveal,
  ApiKeysManager,
  ProfileCard,
  SessionItem,
  SessionsList,
}
