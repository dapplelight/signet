"use client"

// Org screens on signet-db's orgs module and signet-server's `orgRoutes`: an
// org switcher, the member list with roles, an invite dialog, the accept-invite
// page and org settings (name, domain, theme, brand colour). Data comes in as
// props shaped like those routes' responses; actions go out as callbacks.
// Recipe: popup + dismiss + live-region + field-wiring + controllable-state
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { buildTheme } from "@dapplelight/signet-tokens/theme"
import { Building2, Check, ChevronsUpDown, Copy, Plus, Trash2, UserPlus } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
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
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from "../ui/field.js"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js"
import { InviteAccept, type InviteAcceptProps } from "./growth-screens.js"

// -------------------------------------------------------------------- types

/** An org as signet-db's `Org` (the fields these screens read). */
export type OrgSummary = {
  id: string
  name: string
  slug?: string
  domain?: string | null
  theme?: string | null
  brandColor?: string | null
  /** A logo URL, if the app keeps one. */
  image?: string | null
}

/** One row of `GET /api/orgs/current/members`. */
export type OrgMember = {
  userId: string
  role: string
  user?: { name?: string | null; email?: string | null; image?: string | null } | null
}

/** One row of `GET /api/orgs/current/invites`. */
export type OrgInvitation = {
  id: string
  email: string | null
  role: string
  expiresAt: Date | string
}

export type OrgSettingsValue = {
  name: string
  domain: string | null
  theme: string | null
  brandColor: string | null
}

// ------------------------------------------------------------------- labels

const dateText = (d: Date | string) =>
  new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" })

/** Every string the org screens show, in English. Spread and override for another language. */
export const DEFAULT_ORG_LABELS = {
  // switcher
  switchOrg: "Switch organisation",
  orgs: "Organisations",
  createOrg: "New organisation",
  personal: "Personal",
  // members
  membersTitle: "Members",
  you: "you",
  role: "Role",
  roleOf: (name: string) => `Role for ${name}`,
  remove: "Remove",
  removeMember: (name: string) => `Remove ${name}`,
  leave: "Leave",
  noMembers: "No members yet",
  pendingInvites: "Pending invites",
  anyone: "Anyone with the link",
  expires: (d: Date | string) => `Expires ${dateText(d)}`,
  revoke: "Revoke",
  revokeInvite: (to: string) => `Revoke invite for ${to}`,
  // invite
  invite: "Invite",
  inviteTitle: "Invite people",
  inviteBody: "They join with the role you pick.",
  email: "Email",
  emailOptional: "Leave empty for a link anyone can use.",
  emailPlaceholder: "name@example.com",
  invalidEmail: "Enter a valid email",
  send: "Create invite",
  sending: "Creating…",
  inviteLink: "Invite link",
  inviteCreated: "Invite created",
  inviteReady: "Share this link. It is shown once.",
  copy: "Copy",
  copied: "Copied",
  done: "Done",
  cancel: "Cancel",
  // settings
  settingsTitle: "Organisation settings",
  name: "Name",
  domain: "Custom domain",
  domainHint: "Point a CNAME at this app, then enter the host, e.g. app.example.com.",
  invalidDomain: "Enter a host name like app.example.com",
  theme: "Theme",
  brandColor: "Brand colour",
  invalidColor: "Use a colour like #12833c",
  preview: "Preview",
  previewButton: "Primary button",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  failed: "Couldn't save. Try again.",
}
export type OrgLabels = typeof DEFAULT_ORG_LABELS

function useLabels(labels?: Partial<OrgLabels>): OrgLabels {
  return React.useMemo(() => ({ ...DEFAULT_ORG_LABELS, ...labels }), [labels])
}

type PartProps<T extends keyof React.JSX.IntrinsicElements> = useRender.ComponentProps<T>

/** One part element: `render` swaps it, `className` merges over the defaults, `state` becomes `data-*`. */
function usePart<T extends keyof React.JSX.IntrinsicElements>(
  tag: T,
  slot: string,
  base: string,
  { className, render, ...props }: PartProps<T>,
  extra: Record<string, unknown> = {},
  state: Record<string, unknown> = {},
) {
  return useRender({
    defaultTagName: tag,
    render: render as useRender.RenderProp,
    state: { slot, ...state },
    props: mergeProps<"div">(
      { ...extra, className: cn(base, className as string) } as never,
      props as never,
    ),
  })
}

const CARD = "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"
const SELECT =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50 dark:bg-input/30"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const COLOR = /^#[0-9a-f]{6}$/i

function Status({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span role="status" className={className}>
      {children}
    </span>
  )
}

function ErrorLine({ children }: { children?: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive empty:hidden">
      {children}
    </p>
  )
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function OrgMark({ org, className }: { org: OrgSummary; className?: string }) {
  return (
    <Avatar className={cn("size-6 rounded-md", className)}>
      {org.image && <AvatarImage src={org.image} alt="" />}
      <AvatarFallback
        className="rounded-md text-[0.65rem]"
        style={org.brandColor ? { background: org.brandColor, color: "white" } : undefined}
      >
        {initials(org.name)}
      </AvatarFallback>
    </Avatar>
  )
}

// ----------------------------------------------------------------- switcher

export type OrgSwitcherProps = Omit<PartProps<"div">, "onChange"> & {
  orgs: { org: OrgSummary; role?: string }[]
  currentId: string | null
  /** `POST /api/orgs/switch`, then reload or refetch. */
  onSwitch: (orgId: string) => void | Promise<void>
  /** Shows a "New organisation" item. */
  onCreate?: () => void
  labels?: Partial<OrgLabels>
}

/** The current org as a button; opens the list of the user's orgs to switch. */
export function OrgSwitcher({
  orgs,
  currentId,
  onSwitch,
  onCreate,
  labels: labelsProp,
  ...props
}: OrgSwitcherProps) {
  const labels = useLabels(labelsProp)
  const [open, setOpen] = React.useState(false)
  const current = orgs.find((o) => o.org.id === currentId)?.org
  const children = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2"
          aria-label={labels.switchOrg}
        >
          {current ? (
            <OrgMark org={current} />
          ) : (
            <Building2 className="size-4 text-text-muted" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-left font-medium">
            {current?.name ?? labels.orgs}
          </span>
          <ChevronsUpDown className="size-4 text-text-muted" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <p className="px-2 py-1.5 text-xs font-medium text-text-muted">{labels.orgs}</p>
        <ul className="flex flex-col">
          {orgs.map(({ org, role }) => {
            const active = org.id === currentId
            return (
              <li key={org.id}>
                <button
                  type="button"
                  data-slot="org-switcher-item"
                  aria-current={active ? "true" : undefined}
                  onClick={async () => {
                    setOpen(false)
                    if (!active) await onSwitch(org.id)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-bg-muted focus-visible:ring-3 focus-visible:ring-ring"
                >
                  <OrgMark org={org} />
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {role && <span className="text-xs text-text-muted">{role}</span>}
                  {active && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
        {onCreate && (
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onCreate()
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border-default px-2 py-1.5 text-left text-sm text-text-secondary outline-none hover:bg-bg-muted focus-visible:ring-3 focus-visible:ring-ring"
          >
            <Plus className="size-4" aria-hidden />
            {labels.createOrg}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
  return usePart("div", "org-switcher", "w-full", props, { children })
}

// ------------------------------------------------------------------ members

export type MembersListProps = PartProps<"section"> & {
  members: OrgMember[]
  /** Role names the picker offers, e.g. `Object.keys(current.roles)`. */
  roles: string[]
  /** The signed-in user, marked "you"; they can leave but not change their own role. */
  currentUserId?: string
  /** Show the role picker and remove buttons (the caller's `members:manage`). */
  canManage?: boolean
  onRoleChange?: (member: OrgMember, role: string) => void | Promise<void>
  onRemove?: (member: OrgMember) => void | Promise<void>
  /** Pending invites, listed under the members. */
  invitations?: OrgInvitation[]
  onRevokeInvite?: (invite: OrgInvitation) => void | Promise<void>
  /** Shows an Invite button in the header, e.g. to open `InviteDialog`. */
  onInvite?: () => void
  title?: React.ReactNode
  labels?: Partial<OrgLabels>
}

/** Members with their roles; managers change roles, remove people and revoke invites. */
export function MembersList({
  members,
  roles,
  currentUserId,
  canManage = false,
  onRoleChange,
  onRemove,
  invitations = [],
  onRevokeInvite,
  onInvite,
  title,
  labels: labelsProp,
  ...props
}: MembersListProps) {
  const labels = useLabels(labelsProp)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const headingId = React.useId()
  const run = async (key: string, fn: () => void | Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }
  const nameOf = (m: OrgMember) => m.user?.name || m.user?.email || m.userId
  const children = (
    <>
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
          {title ?? labels.membersTitle}{" "}
          <span className="text-sm font-normal text-text-muted tabular-nums">{members.length}</span>
        </h2>
        {onInvite && (
          <Button size="sm" onClick={onInvite}>
            <UserPlus data-icon="inline-start" aria-hidden />
            {labels.invite}
          </Button>
        )}
      </header>
      {members.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">{labels.noMembers}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-default">
          {members.map((m) => {
            const name = nameOf(m)
            const self = m.userId === currentUserId
            return (
              <li
                key={m.userId}
                data-slot="member"
                data-role={m.role}
                className="flex items-center gap-3 py-2.5"
              >
                <Avatar className="size-8">
                  {m.user?.image && <AvatarImage src={m.user.image} alt="" />}
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium text-text-primary">
                    {name}
                    {self && <span className="font-normal text-text-muted"> ({labels.you})</span>}
                  </span>
                  {m.user?.email && m.user.email !== name && (
                    <span className="truncate text-xs text-text-muted">{m.user.email}</span>
                  )}
                </div>
                {canManage && !self && onRoleChange ? (
                  <select
                    aria-label={labels.roleOf(name)}
                    className={SELECT}
                    value={m.role}
                    disabled={busy !== null}
                    onChange={(e) => run(m.userId, () => onRoleChange(m, e.target.value))}
                  >
                    {(roles.includes(m.role) ? roles : [m.role, ...roles]).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant="secondary">{m.role}</Badge>
                )}
                {onRemove && (self || canManage) && (
                  <Button
                    variant="ghost"
                    size={self ? "sm" : "icon-sm"}
                    aria-label={self ? labels.leave : labels.removeMember(name)}
                    disabled={busy !== null}
                    onClick={() => run(`rm:${m.userId}`, () => onRemove(m))}
                  >
                    {self ? labels.leave : <Trash2 aria-hidden />}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {invitations.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-text-secondary">{labels.pendingInvites}</h3>
          <ul className="flex flex-col divide-y divide-border-default">
            {invitations.map((i) => {
              const to = i.email ?? labels.anyone
              return (
                <li key={i.id} data-slot="invitation" className="flex items-center gap-3 py-2">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm text-text-primary">{to}</span>
                    <span className="text-xs text-text-muted">{labels.expires(i.expiresAt)}</span>
                  </div>
                  <Badge variant="outline">{i.role}</Badge>
                  {onRevokeInvite && canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={labels.revokeInvite(to)}
                      disabled={busy !== null}
                      onClick={() => run(`inv:${i.id}`, () => onRevokeInvite(i))}
                    >
                      {labels.revoke}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <ErrorLine>{error}</ErrorLine>
    </>
  )
  return usePart(
    "section",
    "members-list",
    CARD,
    props,
    { "aria-labelledby": headingId, children },
    { manage: canManage },
  )
}

// ------------------------------------------------------------------- invite

export type InviteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Roles the inviter may hand out. The first is the default. */
  roles: string[]
  defaultRole?: string
  /**
   * Ask for an email the invite is bound to. Default true. Turn it off when
   * the app has no verified email to match it against (phone sign-in).
   */
  askEmail?: boolean
  /** `POST /api/orgs/current/invites`; return the link to share. */
  onInvite: (input: { email?: string; role: string }) => Promise<{ link: string }>
  className?: string
  labels?: Partial<OrgLabels>
}

/** Email (optional) and role in; the one-time invite link out, with Copy. */
export function InviteDialog({
  open,
  onOpenChange,
  roles,
  defaultRole,
  askEmail = true,
  onInvite,
  className,
  labels: labelsProp,
}: InviteDialogProps) {
  const labels = useLabels(labelsProp)
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState(defaultRole ?? roles[0] ?? "")
  const [link, setLink] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const roleId = React.useId()
  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      setEmail("")
      setLink(null)
      setError(null)
      setCopied(false)
    }
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (v && !EMAIL.test(v)) {
      setError(labels.invalidEmail)
      return
    }
    setError(null)
    setPending(true)
    try {
      setLink((await onInvite({ ...(v ? { email: v } : {}), role })).link)
    } catch (err) {
      setError(message(err))
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-slot="invite-dialog" className={className}>
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>{labels.inviteCreated}</DialogTitle>
              <DialogDescription>{labels.inviteReady}</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <input
                readOnly
                aria-label={labels.inviteLink}
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 font-mono text-xs text-text-primary"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard?.writeText(link)
                  setCopied(true)
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? labels.copied : labels.copy}
              </Button>
            </div>
            <Status className="sr-only">{copied ? labels.copied : ""}</Status>
            <DialogFooter>
              <Button onClick={() => close(false)}>{labels.done}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{labels.inviteTitle}</DialogTitle>
              <DialogDescription>{labels.inviteBody}</DialogDescription>
            </DialogHeader>
            {askEmail && (
              <Field errors={error === labels.invalidEmail ? [error] : []} className="gap-1.5">
                <FieldLabel>{labels.email}</FieldLabel>
                <FieldControl
                  type="email"
                  autoComplete="off"
                  placeholder={labels.emailPlaceholder}
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                />
                <FieldDescription>{labels.emailOptional}</FieldDescription>
                <FieldError />
              </Field>
            )}
            <div className="grid gap-1.5">
              <label htmlFor={roleId} className="text-sm font-medium text-text-primary">
                {labels.role}
              </label>
              <select
                id={roleId}
                className={SELECT}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <ErrorLine>{error !== labels.invalidEmail ? error : null}</ErrorLine>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={pending || !role}>
                {pending ? labels.sending : labels.send}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------ accept invite

export type AcceptInvitePageProps = InviteAcceptProps & {
  /** The org's logo and colour, from `GET /api/orgs/invites/:token`. */
  org?: OrgSummary
}

/** A full page around `InviteAccept`: the org's mark on top, the card centred. */
export function AcceptInvitePage({ org, className, ...props }: AcceptInvitePageProps) {
  return (
    <main
      data-slot="accept-invite-page"
      className={cn(
        "flex min-h-svh flex-col items-center justify-center gap-6 bg-bg-base p-4",
        className as string,
      )}
    >
      {org && (
        <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
          <OrgMark org={org} className="size-8" />
          {org.name}
        </div>
      )}
      <InviteAccept {...props} invite={{ scopeName: org?.name, ...props.invite }} />
    </main>
  )
}

// ----------------------------------------------------------------- settings

export type OrgSettingsProps = Omit<PartProps<"form">, "onSubmit"> & {
  org: OrgSettingsValue
  /** Theme names to offer, e.g. ["editorial", "cinematic", "finance"]. */
  themes?: string[]
  /** `PATCH /api/orgs/current` with only the changed fields. */
  onSave: (changes: Partial<OrgSettingsValue>) => void | Promise<void>
  /** Read-only without the caller's `org:update`. */
  readOnly?: boolean
  labels?: Partial<OrgLabels>
}

/** Name, custom domain, theme and brand colour, with a live preview of the colour. */
export function OrgSettings({
  org,
  themes = ["editorial", "cinematic", "finance"],
  onSave,
  readOnly = false,
  labels: labelsProp,
  ...props
}: OrgSettingsProps) {
  const labels = useLabels(labelsProp)
  const [v, setV] = React.useState<OrgSettingsValue>(org)
  const [errors, setErrors] = React.useState<Partial<Record<keyof OrgSettingsValue, string>>>({})
  const [state, setState] = React.useState<"idle" | "pending" | "saved" | "failed">("idle")
  const [failure, setFailure] = React.useState<string | null>(null)
  const headingId = React.useId()
  const themeId = React.useId()
  const set = (k: keyof OrgSettingsValue, value: string | null) => {
    setV((o) => ({ ...o, [k]: value }))
    if (state === "saved") setState("idle")
  }
  const color = v.brandColor && COLOR.test(v.brandColor) ? v.brandColor : null
  const preview = React.useMemo(() => {
    if (!color) return null
    try {
      const vars = buildTheme({ brand: color, mode: "light" }).light ?? {}
      return { bg: vars["--primary"] ?? color, fg: vars["--primary-foreground"] ?? "#fff" }
    } catch {
      return null
    }
  }, [color])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!v.name.trim()) next.name = labels.name
    if (v.domain && !DOMAIN.test(v.domain.trim())) next.domain = labels.invalidDomain
    if (v.brandColor && !COLOR.test(v.brandColor.trim())) next.brandColor = labels.invalidColor
    setErrors(next)
    if (Object.keys(next).length) return
    const norm = (s: string | null) => (s?.trim() ? s.trim() : null)
    const out: Partial<OrgSettingsValue> = {}
    if (v.name.trim() !== org.name) out.name = v.name.trim()
    for (const k of ["domain", "theme", "brandColor"] as const)
      if (norm(v[k]) !== (org[k] ?? null)) out[k] = norm(v[k])
    if (Object.keys(out).length === 0) return
    setState("pending")
    setFailure(null)
    try {
      await onSave(out)
      setState("saved")
    } catch (err) {
      setState("failed")
      setFailure(message(err) || labels.failed)
    }
  }
  const children = (
    <>
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
        {labels.settingsTitle}
      </h2>
      <fieldset disabled={readOnly} className="grid gap-4">
        <Field errors={errors.name ? [errors.name] : []} className="gap-1.5">
          <FieldLabel>{labels.name}</FieldLabel>
          <FieldControl
            required
            maxLength={100}
            value={v.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("name", e.target.value)}
          />
          <FieldError />
        </Field>
        <Field errors={errors.domain ? [errors.domain] : []} className="gap-1.5">
          <FieldLabel>{labels.domain}</FieldLabel>
          <FieldControl
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="app.example.com"
            value={v.domain ?? ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("domain", e.target.value)}
          />
          <FieldDescription>{labels.domainHint}</FieldDescription>
          <FieldError />
        </Field>
        <div className="grid gap-1.5">
          <label htmlFor={themeId} className="text-sm font-medium text-text-primary">
            {labels.theme}
          </label>
          <select
            id={themeId}
            className={SELECT}
            value={v.theme ?? ""}
            onChange={(e) => set("theme", e.target.value || null)}
          >
            <option value="">—</option>
            {themes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Field errors={errors.brandColor ? [errors.brandColor] : []} className="gap-1.5">
          <FieldLabel>{labels.brandColor}</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-hidden
              tabIndex={-1}
              value={color ?? "#000000"}
              onChange={(e) => set("brandColor", e.target.value)}
              className="h-8 w-10 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
            />
            <FieldControl
              className="font-mono"
              placeholder="#12833c"
              maxLength={7}
              value={v.brandColor ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set("brandColor", e.target.value)
              }
            />
          </div>
          <FieldError />
        </Field>
        {preview && (
          <div data-slot="org-theme-preview" className="flex items-center gap-3">
            <span className="text-xs text-text-muted">{labels.preview}</span>
            <span
              className="rounded-lg px-3 py-1.5 text-sm font-medium"
              style={{ background: preview.bg, color: preview.fg }}
            >
              {labels.previewButton}
            </span>
          </div>
        )}
      </fieldset>
      <div className="flex items-center justify-end gap-3">
        <Status
          className={cn(
            "text-sm empty:hidden",
            state === "failed" ? "text-destructive" : "text-accent-green",
          )}
        >
          {state === "saved" ? labels.saved : state === "failed" ? failure : ""}
        </Status>
        {!readOnly && (
          <Button type="submit" disabled={state === "pending"}>
            {state === "pending" ? labels.saving : labels.save}
          </Button>
        )}
      </div>
    </>
  )
  return usePart(
    "form",
    "org-settings",
    CARD,
    props,
    { "aria-labelledby": headingId, noValidate: true, onSubmit: submit, children },
    { state },
  )
}
"use client"

// Org screens on signet-db's orgs module and signet-server's `orgRoutes`: an
// org switcher, the member list with roles, an invite dialog, the accept-invite
// page and org settings (name, domain, theme, brand colour). Data comes in as
// props shaped like those routes' responses; actions go out as callbacks.
// Recipe: popup + dismiss + live-region + field-wiring + controllable-state
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { buildTheme } from "@dapplelight/signet-tokens/theme"
import { Building2, Check, ChevronsUpDown, Copy, Plus, Trash2, UserPlus } from "lucide-react"
import * as React from "react"
import { cn } from "../../lib/utils.js"
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
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from "../ui/field.js"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js"
import { InviteAccept, type InviteAcceptProps } from "./growth-screens.js"

// -------------------------------------------------------------------- types

/** An org as signet-db's `Org` (the fields these screens read). */
export type OrgSummary = {
  id: string
  name: string
  slug?: string
  domain?: string | null
  theme?: string | null
  brandColor?: string | null
  /** A logo URL, if the app keeps one. */
  image?: string | null
}

/** One row of `GET /api/orgs/current/members`. */
export type OrgMember = {
  userId: string
  role: string
  user?: { name?: string | null; email?: string | null; image?: string | null } | null
}

/** One row of `GET /api/orgs/current/invites`. */
export type OrgInvitation = {
  id: string
  email: string | null
  role: string
  expiresAt: Date | string
}

export type OrgSettingsValue = {
  name: string
  domain: string | null
  theme: string | null
  brandColor: string | null
}

// ------------------------------------------------------------------- labels

const dateText = (d: Date | string) =>
  new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" })

/** Every string the org screens show, in English. Spread and override for another language. */
export const DEFAULT_ORG_LABELS = {
  // switcher
  switchOrg: "Switch organisation",
  orgs: "Organisations",
  createOrg: "New organisation",
  personal: "Personal",
  // members
  membersTitle: "Members",
  you: "you",
  role: "Role",
  roleOf: (name: string) => `Role for ${name}`,
  remove: "Remove",
  removeMember: (name: string) => `Remove ${name}`,
  leave: "Leave",
  noMembers: "No members yet",
  pendingInvites: "Pending invites",
  anyone: "Anyone with the link",
  expires: (d: Date | string) => `Expires ${dateText(d)}`,
  revoke: "Revoke",
  revokeInvite: (to: string) => `Revoke invite for ${to}`,
  // invite
  invite: "Invite",
  inviteTitle: "Invite people",
  inviteBody: "They join with the role you pick.",
  email: "Email",
  emailOptional: "Leave empty for a link anyone can use.",
  emailPlaceholder: "name@example.com",
  invalidEmail: "Enter a valid email",
  send: "Create invite",
  sending: "Creating…",
  inviteLink: "Invite link",
  inviteCreated: "Invite created",
  inviteReady: "Share this link. It is shown once.",
  copy: "Copy",
  copied: "Copied",
  done: "Done",
  cancel: "Cancel",
  // settings
  settingsTitle: "Organisation settings",
  name: "Name",
  domain: "Custom domain",
  domainHint: "Point a CNAME at this app, then enter the host, e.g. app.example.com.",
  invalidDomain: "Enter a host name like app.example.com",
  theme: "Theme",
  brandColor: "Brand colour",
  invalidColor: "Use a colour like #12833c",
  preview: "Preview",
  previewButton: "Primary button",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  failed: "Couldn't save. Try again.",
}
export type OrgLabels = typeof DEFAULT_ORG_LABELS

function useLabels(labels?: Partial<OrgLabels>): OrgLabels {
  return React.useMemo(() => ({ ...DEFAULT_ORG_LABELS, ...labels }), [labels])
}

type PartProps<T extends keyof React.JSX.IntrinsicElements> = useRender.ComponentProps<T>

/** One part element: `render` swaps it, `className` merges over the defaults, `state` becomes `data-*`. */
function usePart<T extends keyof React.JSX.IntrinsicElements>(
  tag: T,
  slot: string,
  base: string,
  { className, render, ...props }: PartProps<T>,
  extra: Record<string, unknown> = {},
  state: Record<string, unknown> = {},
) {
  return useRender({
    defaultTagName: tag,
    render: render as useRender.RenderProp,
    state: { slot, ...state },
    props: mergeProps<"div">(
      { ...extra, className: cn(base, className as string) } as never,
      props as never,
    ),
  })
}

const CARD = "flex flex-col gap-4 rounded-xl bg-bg-surface p-5 ring-1 ring-border-default"
const SELECT =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-text-primary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50 dark:bg-input/30"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const COLOR = /^#[0-9a-f]{6}$/i

function Status({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span role="status" className={className}>
      {children}
    </span>
  )
}

function ErrorLine({ children }: { children?: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive empty:hidden">
      {children}
    </p>
  )
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function OrgMark({ org, className }: { org: OrgSummary; className?: string }) {
  return (
    <Avatar className={cn("size-6 rounded-md", className)}>
      {org.image && <AvatarImage src={org.image} alt="" />}
      <AvatarFallback
        className="rounded-md text-[0.65rem]"
        style={org.brandColor ? { background: org.brandColor, color: "white" } : undefined}
      >
        {initials(org.name)}
      </AvatarFallback>
    </Avatar>
  )
}

// ----------------------------------------------------------------- switcher

export type OrgSwitcherProps = Omit<PartProps<"div">, "onChange"> & {
  orgs: { org: OrgSummary; role?: string }[]
  currentId: string | null
  /** `POST /api/orgs/switch`, then reload or refetch. */
  onSwitch: (orgId: string) => void | Promise<void>
  /** Shows a "New organisation" item. */
  onCreate?: () => void
  labels?: Partial<OrgLabels>
}

/** The current org as a button; opens the list of the user's orgs to switch. */
export function OrgSwitcher({
  orgs,
  currentId,
  onSwitch,
  onCreate,
  labels: labelsProp,
  ...props
}: OrgSwitcherProps) {
  const labels = useLabels(labelsProp)
  const [open, setOpen] = React.useState(false)
  const current = orgs.find((o) => o.org.id === currentId)?.org
  const children = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2"
          aria-label={labels.switchOrg}
        >
          {current ? (
            <OrgMark org={current} />
          ) : (
            <Building2 className="size-4 text-text-muted" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-left font-medium">
            {current?.name ?? labels.orgs}
          </span>
          <ChevronsUpDown className="size-4 text-text-muted" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <p className="px-2 py-1.5 text-xs font-medium text-text-muted">{labels.orgs}</p>
        <ul className="flex flex-col">
          {orgs.map(({ org, role }) => {
            const active = org.id === currentId
            return (
              <li key={org.id}>
                <button
                  type="button"
                  data-slot="org-switcher-item"
                  aria-current={active ? "true" : undefined}
                  onClick={async () => {
                    setOpen(false)
                    if (!active) await onSwitch(org.id)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-bg-muted focus-visible:ring-3 focus-visible:ring-ring"
                >
                  <OrgMark org={org} />
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {role && <span className="text-xs text-text-muted">{role}</span>}
                  {active && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
        {onCreate && (
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onCreate()
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border-default px-2 py-1.5 text-left text-sm text-text-secondary outline-none hover:bg-bg-muted focus-visible:ring-3 focus-visible:ring-ring"
          >
            <Plus className="size-4" aria-hidden />
            {labels.createOrg}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
  return usePart("div", "org-switcher", "w-full", props, { children })
}

// ------------------------------------------------------------------ members

export type MembersListProps = PartProps<"section"> & {
  members: OrgMember[]
  /** Role names the picker offers, e.g. `Object.keys(current.roles)`. */
  roles: string[]
  /** The signed-in user, marked "you"; they can leave but not change their own role. */
  currentUserId?: string
  /** Show the role picker and remove buttons (the caller's `members:manage`). */
  canManage?: boolean
  onRoleChange?: (member: OrgMember, role: string) => void | Promise<void>
  onRemove?: (member: OrgMember) => void | Promise<void>
  /** Pending invites, listed under the members. */
  invitations?: OrgInvitation[]
  onRevokeInvite?: (invite: OrgInvitation) => void | Promise<void>
  /** Shows an Invite button in the header, e.g. to open `InviteDialog`. */
  onInvite?: () => void
  title?: React.ReactNode
  labels?: Partial<OrgLabels>
}

/** Members with their roles; managers change roles, remove people and revoke invites. */
export function MembersList({
  members,
  roles,
  currentUserId,
  canManage = false,
  onRoleChange,
  onRemove,
  invitations = [],
  onRevokeInvite,
  onInvite,
  title,
  labels: labelsProp,
  ...props
}: MembersListProps) {
  const labels = useLabels(labelsProp)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const headingId = React.useId()
  const run = async (key: string, fn: () => void | Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }
  const nameOf = (m: OrgMember) => m.user?.name || m.user?.email || m.userId
  const children = (
    <>
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
          {title ?? labels.membersTitle}{" "}
          <span className="text-sm font-normal text-text-muted tabular-nums">{members.length}</span>
        </h2>
        {onInvite && (
          <Button size="sm" onClick={onInvite}>
            <UserPlus data-icon="inline-start" aria-hidden />
            {labels.invite}
          </Button>
        )}
      </header>
      {members.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">{labels.noMembers}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-default">
          {members.map((m) => {
            const name = nameOf(m)
            const self = m.userId === currentUserId
            return (
              <li
                key={m.userId}
                data-slot="member"
                data-role={m.role}
                className="flex items-center gap-3 py-2.5"
              >
                <Avatar className="size-8">
                  {m.user?.image && <AvatarImage src={m.user.image} alt="" />}
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium text-text-primary">
                    {name}
                    {self && <span className="font-normal text-text-muted"> ({labels.you})</span>}
                  </span>
                  {m.user?.email && m.user.email !== name && (
                    <span className="truncate text-xs text-text-muted">{m.user.email}</span>
                  )}
                </div>
                {canManage && !self && onRoleChange ? (
                  <select
                    aria-label={labels.roleOf(name)}
                    className={SELECT}
                    value={m.role}
                    disabled={busy !== null}
                    onChange={(e) => run(m.userId, () => onRoleChange(m, e.target.value))}
                  >
                    {(roles.includes(m.role) ? roles : [m.role, ...roles]).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant="secondary">{m.role}</Badge>
                )}
                {onRemove && (self || canManage) && (
                  <Button
                    variant="ghost"
                    size={self ? "sm" : "icon-sm"}
                    aria-label={self ? labels.leave : labels.removeMember(name)}
                    disabled={busy !== null}
                    onClick={() => run(`rm:${m.userId}`, () => onRemove(m))}
                  >
                    {self ? labels.leave : <Trash2 aria-hidden />}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {invitations.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-text-secondary">{labels.pendingInvites}</h3>
          <ul className="flex flex-col divide-y divide-border-default">
            {invitations.map((i) => {
              const to = i.email ?? labels.anyone
              return (
                <li key={i.id} data-slot="invitation" className="flex items-center gap-3 py-2">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm text-text-primary">{to}</span>
                    <span className="text-xs text-text-muted">{labels.expires(i.expiresAt)}</span>
                  </div>
                  <Badge variant="outline">{i.role}</Badge>
                  {onRevokeInvite && canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={labels.revokeInvite(to)}
                      disabled={busy !== null}
                      onClick={() => run(`inv:${i.id}`, () => onRevokeInvite(i))}
                    >
                      {labels.revoke}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <ErrorLine>{error}</ErrorLine>
    </>
  )
  return usePart(
    "section",
    "members-list",
    CARD,
    props,
    { "aria-labelledby": headingId, children },
    { manage: canManage },
  )
}

// ------------------------------------------------------------------- invite

export type InviteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Roles the inviter may hand out. The first is the default. */
  roles: string[]
  defaultRole?: string
  /** `POST /api/orgs/current/invites`; return the link to share. */
  onInvite: (input: { email?: string; role: string }) => Promise<{ link: string }>
  className?: string
  labels?: Partial<OrgLabels>
}

/** Email (optional) and role in; the one-time invite link out, with Copy. */
export function InviteDialog({
  open,
  onOpenChange,
  roles,
  defaultRole,
  onInvite,
  className,
  labels: labelsProp,
}: InviteDialogProps) {
  const labels = useLabels(labelsProp)
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState(defaultRole ?? roles[0] ?? "")
  const [link, setLink] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const roleId = React.useId()
  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      setEmail("")
      setLink(null)
      setError(null)
      setCopied(false)
    }
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (v && !EMAIL.test(v)) {
      setError(labels.invalidEmail)
      return
    }
    setError(null)
    setPending(true)
    try {
      setLink((await onInvite({ ...(v ? { email: v } : {}), role })).link)
    } catch (err) {
      setError(message(err))
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-slot="invite-dialog" className={className}>
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>{labels.inviteCreated}</DialogTitle>
              <DialogDescription>{labels.inviteReady}</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <input
                readOnly
                aria-label={labels.inviteLink}
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 font-mono text-xs text-text-primary"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard?.writeText(link)
                  setCopied(true)
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? labels.copied : labels.copy}
              </Button>
            </div>
            <Status className="sr-only">{copied ? labels.copied : ""}</Status>
            <DialogFooter>
              <Button onClick={() => close(false)}>{labels.done}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{labels.inviteTitle}</DialogTitle>
              <DialogDescription>{labels.inviteBody}</DialogDescription>
            </DialogHeader>
            <Field errors={error === labels.invalidEmail ? [error] : []} className="gap-1.5">
              <FieldLabel>{labels.email}</FieldLabel>
              <FieldControl
                type="email"
                autoComplete="off"
                placeholder={labels.emailPlaceholder}
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              />
              <FieldDescription>{labels.emailOptional}</FieldDescription>
              <FieldError />
            </Field>
            <div className="grid gap-1.5">
              <label htmlFor={roleId} className="text-sm font-medium text-text-primary">
                {labels.role}
              </label>
              <select
                id={roleId}
                className={SELECT}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <ErrorLine>{error !== labels.invalidEmail ? error : null}</ErrorLine>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={pending || !role}>
                {pending ? labels.sending : labels.send}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------ accept invite

export type AcceptInvitePageProps = InviteAcceptProps & {
  /** The org's logo and colour, from `GET /api/orgs/invites/:token`. */
  org?: OrgSummary
}

/** A full page around `InviteAccept`: the org's mark on top, the card centred. */
export function AcceptInvitePage({ org, className, ...props }: AcceptInvitePageProps) {
  return (
    <main
      data-slot="accept-invite-page"
      className={cn(
        "flex min-h-svh flex-col items-center justify-center gap-6 bg-bg-base p-4",
        className as string,
      )}
    >
      {org && (
        <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
          <OrgMark org={org} className="size-8" />
          {org.name}
        </div>
      )}
      <InviteAccept {...props} invite={{ scopeName: org?.name, ...props.invite }} />
    </main>
  )
}

// ----------------------------------------------------------------- settings

export type OrgSettingsProps = Omit<PartProps<"form">, "onSubmit"> & {
  org: OrgSettingsValue
  /** Theme names to offer, e.g. ["editorial", "cinematic", "finance"]. */
  themes?: string[]
  /** `PATCH /api/orgs/current` with only the changed fields. */
  onSave: (changes: Partial<OrgSettingsValue>) => void | Promise<void>
  /** Read-only without the caller's `org:update`. */
  readOnly?: boolean
  labels?: Partial<OrgLabels>
}

/** Name, custom domain, theme and brand colour, with a live preview of the colour. */
export function OrgSettings({
  org,
  themes = ["editorial", "cinematic", "finance"],
  onSave,
  readOnly = false,
  labels: labelsProp,
  ...props
}: OrgSettingsProps) {
  const labels = useLabels(labelsProp)
  const [v, setV] = React.useState<OrgSettingsValue>(org)
  const [errors, setErrors] = React.useState<Partial<Record<keyof OrgSettingsValue, string>>>({})
  const [state, setState] = React.useState<"idle" | "pending" | "saved" | "failed">("idle")
  const [failure, setFailure] = React.useState<string | null>(null)
  const headingId = React.useId()
  const themeId = React.useId()
  const set = (k: keyof OrgSettingsValue, value: string | null) => {
    setV((o) => ({ ...o, [k]: value }))
    if (state === "saved") setState("idle")
  }
  const color = v.brandColor && COLOR.test(v.brandColor) ? v.brandColor : null
  const preview = React.useMemo(() => {
    if (!color) return null
    try {
      const vars = buildTheme({ brand: color, mode: "light" }).light ?? {}
      return { bg: vars["--primary"] ?? color, fg: vars["--primary-foreground"] ?? "#fff" }
    } catch {
      return null
    }
  }, [color])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!v.name.trim()) next.name = labels.name
    if (v.domain && !DOMAIN.test(v.domain.trim())) next.domain = labels.invalidDomain
    if (v.brandColor && !COLOR.test(v.brandColor.trim())) next.brandColor = labels.invalidColor
    setErrors(next)
    if (Object.keys(next).length) return
    const norm = (s: string | null) => (s?.trim() ? s.trim() : null)
    const out: Partial<OrgSettingsValue> = {}
    if (v.name.trim() !== org.name) out.name = v.name.trim()
    for (const k of ["domain", "theme", "brandColor"] as const)
      if (norm(v[k]) !== (org[k] ?? null)) out[k] = norm(v[k])
    if (Object.keys(out).length === 0) return
    setState("pending")
    setFailure(null)
    try {
      await onSave(out)
      setState("saved")
    } catch (err) {
      setState("failed")
      setFailure(message(err) || labels.failed)
    }
  }
  const children = (
    <>
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
        {labels.settingsTitle}
      </h2>
      <fieldset disabled={readOnly} className="grid gap-4">
        <Field errors={errors.name ? [errors.name] : []} className="gap-1.5">
          <FieldLabel>{labels.name}</FieldLabel>
          <FieldControl
            required
            maxLength={100}
            value={v.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("name", e.target.value)}
          />
          <FieldError />
        </Field>
        <Field errors={errors.domain ? [errors.domain] : []} className="gap-1.5">
          <FieldLabel>{labels.domain}</FieldLabel>
          <FieldControl
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="app.example.com"
            value={v.domain ?? ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set("domain", e.target.value)}
          />
          <FieldDescription>{labels.domainHint}</FieldDescription>
          <FieldError />
        </Field>
        <div className="grid gap-1.5">
          <label htmlFor={themeId} className="text-sm font-medium text-text-primary">
            {labels.theme}
          </label>
          <select
            id={themeId}
            className={SELECT}
            value={v.theme ?? ""}
            onChange={(e) => set("theme", e.target.value || null)}
          >
            <option value="">—</option>
            {themes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Field errors={errors.brandColor ? [errors.brandColor] : []} className="gap-1.5">
          <FieldLabel>{labels.brandColor}</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-hidden
              tabIndex={-1}
              value={color ?? "#000000"}
              onChange={(e) => set("brandColor", e.target.value)}
              className="h-8 w-10 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
            />
            <FieldControl
              className="font-mono"
              placeholder="#12833c"
              maxLength={7}
              value={v.brandColor ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                set("brandColor", e.target.value)
              }
            />
          </div>
          <FieldError />
        </Field>
        {preview && (
          <div data-slot="org-theme-preview" className="flex items-center gap-3">
            <span className="text-xs text-text-muted">{labels.preview}</span>
            <span
              className="rounded-lg px-3 py-1.5 text-sm font-medium"
              style={{ background: preview.bg, color: preview.fg }}
            >
              {labels.previewButton}
            </span>
          </div>
        )}
      </fieldset>
      <div className="flex items-center justify-end gap-3">
        <Status
          className={cn(
            "text-sm empty:hidden",
            state === "failed" ? "text-destructive" : "text-accent-green",
          )}
        >
          {state === "saved" ? labels.saved : state === "failed" ? failure : ""}
        </Status>
        {!readOnly && (
          <Button type="submit" disabled={state === "pending"}>
            {state === "pending" ? labels.saving : labels.save}
          </Button>
        )}
      </div>
    </>
  )
  return usePart(
    "form",
    "org-settings",
    CARD,
    props,
    { "aria-labelledby": headingId, noValidate: true, onSubmit: submit, children },
    { state },
  )
}
