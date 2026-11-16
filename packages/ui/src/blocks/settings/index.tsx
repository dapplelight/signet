"use client"

// Block: settings page. A General card (name, description), a Notifications
// card (switches) and a Danger zone whose delete asks you to type the
// workspace name. Each form card saves on its own, "Save changes" stays
// disabled until something changed, and a saved form toasts: mount <Toaster/>
// once in your app. Copy it in with `signet add block settings` and edit it:
// values, save callbacks and labels are props, every part has a data-slot, and
// the root takes className.
import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog.js"
import { Button } from "../../components/ui/button.js"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js"
import { ErrorState } from "../../components/ui/error-state.js"
import { Field, FieldControl, FieldError, FieldLabel } from "../../components/ui/field.js"
import { Skeleton } from "../../components/ui/skeleton.js"
import { Spinner } from "../../components/ui/spinner.js"
import { Switch } from "../../components/ui/switch.js"
import { Textarea } from "../../components/ui/textarea.js"
import { toast } from "../../components/ui/toast.js"
import { cn } from "../../lib/utils.js"

export type BlockState = "ready" | "loading" | "error"

export type GeneralValues = { name: string; description: string }
export type NotificationValues = { emailUpdates: boolean; weeklySummary: boolean }

/** Generic starting values. Pass your own `general` and `notifications`. */
export const SAMPLE_GENERAL: GeneralValues = {
  name: "Acme Studio",
  description: "Design and product work for small teams.",
}
export const SAMPLE_NOTIFICATIONS: NotificationValues = {
  emailUpdates: true,
  weeklySummary: false,
}

/** Every string the block shows. Spread it and override what you need. */
export const DEFAULT_SETTINGS_LABELS = {
  general: "General",
  generalDescription: "The basics about your workspace.",
  workspaceName: "Workspace name",
  description: "Description",
  nameRequired: "Enter a workspace name.",
  notifications: "Notifications",
  notificationsDescription: "Choose what we email you about.",
  emailUpdates: "Email updates",
  emailUpdatesHint: "Product news and account notices.",
  weeklySummary: "Weekly summary",
  weeklySummaryHint: "A digest of what happened, every Monday.",
  save: "Save changes",
  saved: "Changes saved",
  saveError: "Could not save. Try again.",
  dangerZone: "Danger zone",
  dangerDescription: "Permanent actions. There is no undo.",
  deleteWorkspace: "Delete workspace",
  deleteTitle: (name: string) => `Delete ${name}?`,
  deleteBody: "This removes all its data and cannot be undone.",
  deleteConfirm: (name: string) => `Type ${name} to confirm`,
  cancel: "Cancel",
  delete: "Delete",
  errorMessage: "We could not load your settings.",
  loading: "Loading settings",
}

export type SettingsLabels = typeof DEFAULT_SETTINGS_LABELS

type Part = "general" | "notifications" | "danger"

/** A save callback may reject, or resolve with messages to show under fields. */
type Save<T> = (values: T) => void | Promise<void | Partial<Record<keyof T, string>>>

export type SettingsProps = {
  general?: GeneralValues
  notifications?: NotificationValues
  state?: BlockState
  onRetry?: () => void
  onSaveGeneral?: Save<GeneralValues>
  onSaveNotifications?: Save<NotificationValues>
  /** Runs when the user confirms the delete. The dialog stays open until it settles. */
  onDelete?: () => void | Promise<void>
  labels?: Partial<SettingsLabels>
  classNames?: Partial<Record<Part, string>>
  className?: string
}

/**
 * A form's values, the last saved copy, and a save that toasts. `dirty` is
 * false until a value differs from what was last saved.
 */
function useSavedForm<T extends Record<string, string | boolean>>(
  initial: T,
  onSave: Save<T> | undefined,
  labels: Pick<SettingsLabels, "saved" | "saveError">,
  validate?: (v: T) => Partial<Record<keyof T, string>>,
) {
  const [saved, setSaved] = React.useState(initial)
  const [values, setValues] = React.useState(initial)
  const [errors, setErrors] = React.useState<Partial<Record<keyof T, string>>>({})
  const [failed, setFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const dirty = (Object.keys(saved) as (keyof T)[]).some((k) => saved[k] !== values[k])

  // Incoming values replace the form (loading -> ready). Compared by content so a
  // parent passing a fresh-but-equal object each render does not wipe edits.
  const incoming = JSON.stringify(initial)
  const seen = React.useRef(incoming)
  if (seen.current !== incoming) {
    seen.current = incoming
    setSaved(initial)
    setValues(initial)
    setErrors({})
    setFailed(false)
  }

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dirty || saving) return
    const found = validate?.(values) ?? {}
    if (Object.values(found).some(Boolean)) return setErrors(found)
    setSaving(true)
    setFailed(false)
    try {
      const rejected = await onSave?.(values)
      if (rejected && Object.values(rejected).some(Boolean)) return setErrors(rejected)
      setSaved(values)
      toast.success(labels.saved)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }
  return { values, set, errors, failed, saving, dirty, submit, saveError: labels.saveError }
}

function SaveFooter({
  label,
  saving,
  dirty,
  failed,
  error,
}: {
  label: string
  saving: boolean
  dirty: boolean
  failed: boolean
  error: string
}) {
  return (
    <CardFooter data-slot="settings-footer" className="justify-between gap-3">
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {failed ? error : null}
      </p>
      <Button type="submit" size="touch" className="ml-auto md:h-8" disabled={!dirty || saving}>
        {saving && <Spinner className="text-current" role="presentation" aria-hidden="true" />}
        {label}
      </Button>
    </CardFooter>
  )
}

export function Settings({
  general = SAMPLE_GENERAL,
  notifications = SAMPLE_NOTIFICATIONS,
  state = "ready",
  onRetry,
  onSaveGeneral,
  onSaveNotifications,
  onDelete,
  labels: labelOverrides,
  classNames,
  className,
}: SettingsProps) {
  const l = { ...DEFAULT_SETTINGS_LABELS, ...labelOverrides }
  const gen = useSavedForm(general, onSaveGeneral, l, (v) =>
    v.name.trim() ? {} : { name: l.nameRequired },
  )
  const notif = useSavedForm(notifications, onSaveNotifications, l)
  const hintId = React.useId()

  return (
    <section
      data-block="settings"
      data-state={state}
      aria-busy={state === "loading" || undefined}
      className={cn("mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:gap-6 md:p-6", className)}
    >
      {state === "error" ? (
        <Card data-slot="settings-error">
          <CardContent>
            <ErrorState message={l.errorMessage} onRetry={onRetry} />
          </CardContent>
        </Card>
      ) : state === "loading" ? (
        <SettingsSkeleton label={l.loading} />
      ) : (
        <>
          <form
            noValidate
            onSubmit={gen.submit}
            data-slot="settings-general"
            className={cn("contents", classNames?.general)}
          >
            <Card>
              <CardHeader>
                <CardTitle>{l.general}</CardTitle>
                <CardDescription>{l.generalDescription}</CardDescription>
              </CardHeader>
              <CardContent className="grid max-w-xl gap-4">
                <Field errors={gen.errors.name ? [gen.errors.name] : []}>
                  <FieldLabel>{l.workspaceName}</FieldLabel>
                  <FieldControl
                    name="name"
                    value={gen.values.name}
                    onChange={(e) => gen.set("name", e.target.value)}
                    className="h-11 md:h-8"
                  />
                  <FieldError />
                </Field>
                <Field errors={gen.errors.description ? [gen.errors.description] : []}>
                  <FieldLabel>{l.description}</FieldLabel>
                  <FieldControl
                    name="description"
                    render={<Textarea />}
                    value={gen.values.description}
                    onChange={(e) => gen.set("description", e.target.value)}
                  />
                  <FieldError />
                </Field>
              </CardContent>
              <SaveFooter
                label={l.save}
                saving={gen.saving}
                dirty={gen.dirty}
                failed={gen.failed}
                error={gen.saveError}
              />
            </Card>
          </form>

          <form
            noValidate
            onSubmit={notif.submit}
            data-slot="settings-notifications"
            className={cn("contents", classNames?.notifications)}
          >
            <Card>
              <CardHeader>
                <CardTitle>{l.notifications}</CardTitle>
                <CardDescription>{l.notificationsDescription}</CardDescription>
              </CardHeader>
              <CardContent className="flex max-w-xl flex-col divide-y divide-border-subtle">
                {(
                  [
                    ["emailUpdates", l.emailUpdates, l.emailUpdatesHint],
                    ["weeklySummary", l.weeklySummary, l.weeklySummaryHint],
                  ] as const
                ).map(([key, title, hint]) => (
                  // biome-ignore lint/a11y/noLabelWithoutControl: the Switch inside is the control
                  <label
                    key={key}
                    className="flex min-h-14 items-center justify-between gap-4 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span id={`${hintId}-${key}`} className="block font-medium text-text-primary">
                        {title}
                      </span>
                      <span className="block text-text-muted">{hint}</span>
                    </span>
                    <Switch
                      aria-labelledby={`${hintId}-${key}`}
                      checked={notif.values[key]}
                      onCheckedChange={(on) => notif.set(key, on)}
                    />
                  </label>
                ))}
              </CardContent>
              <SaveFooter
                label={l.save}
                saving={notif.saving}
                dirty={notif.dirty}
                failed={notif.failed}
                error={notif.saveError}
              />
            </Card>
          </form>

          <Card
            data-slot="settings-danger"
            className={cn("ring-destructive/50", classNames?.danger)}
          >
            <CardHeader>
              <CardTitle>{l.dangerZone}</CardTitle>
              <CardDescription>{l.dangerDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="destructive" size="touch" className="md:h-8" />}
                >
                  {l.deleteWorkspace}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <DeleteConfirm name={general.name} labels={l} onDelete={onDelete} />
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  )
}

/** Its own component so the typed text starts empty each time the dialog opens. */
function DeleteConfirm({
  name,
  labels: l,
  onDelete,
}: {
  name: string
  labels: SettingsLabels
  onDelete?: () => void | Promise<void>
}) {
  const [typed, setTyped] = React.useState("")
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{l.deleteTitle(name)}</AlertDialogTitle>
        <AlertDialogDescription>{l.deleteBody}</AlertDialogDescription>
      </AlertDialogHeader>
      <Field>
        <FieldLabel>{l.deleteConfirm(name)}</FieldLabel>
        <FieldControl
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          className="h-11 md:h-8"
        />
      </Field>
      <AlertDialogFooter>
        <AlertDialogCancel className="h-11 md:h-8">{l.cancel}</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          className="h-11 md:h-8"
          disabled={typed !== name}
          action={async () => void (await onDelete?.())}
        >
          {l.delete}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  )
}

/** Same shapes as the real content: two form cards and the danger card. */
function SettingsSkeleton({ label }: { label: string }) {
  return (
    <div
      data-slot="settings-skeleton"
      role="status"
      aria-label={label}
      className="flex flex-col gap-4 md:gap-6"
    >
      {[
        { title: "w-28", fields: 2 },
        { title: "w-36", fields: 2 },
        { title: "w-32", fields: 0 },
      ].map((c) => (
        <Card key={c.title}>
          <CardHeader>
            <Skeleton className={cn("h-5", c.title)} />
          </CardHeader>
          <CardContent className="flex max-w-xl flex-col gap-4">
            {Array.from({ length: c.fields }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full md:h-8" />
            ))}
            {c.fields === 0 && <Skeleton className="h-11 w-44 md:h-8" />}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
