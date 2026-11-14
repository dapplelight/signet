import { useCallback, useId, useRef, useState } from "react"
import { cn } from "../../lib/utils.js"
import { Button } from "../ui/button.js"
import { Progress } from "../ui/progress.js"

/** Where to send one file: a presigned URL from signet-server's `presignUpload`, or your own endpoint. */
export type UploadTarget = {
  url: string
  method?: "PUT" | "POST"
  headers?: Record<string, string>
}

/** Sends `file` to `target`, reporting progress from 0 to 1. The default is an XHR PUT. */
export type UploadTransport = (
  file: File,
  target: UploadTarget,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
) => Promise<void>

/** XHR, because fetch has no upload progress. */
export const xhrUpload: UploadTransport = (file, target, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(target.method ?? "PUT", target.url)
    for (const [k, v] of Object.entries(target.headers ?? {})) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`))
    xhr.onerror = () => reject(new Error("Upload failed: network error"))
    xhr.onabort = () => reject(new Error("Upload cancelled"))
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(file)
  })

type Item = {
  id: string
  file: File
  progress: number
  status: "uploading" | "done" | "error"
  error?: string
}

type UploadProps = {
  /** Ask your server for a target per file (it checks size, type and quota first). */
  getTarget: (file: File) => Promise<UploadTarget>
  /** After the bytes are sent: confirm the upload with your server here. */
  onUploaded?: (file: File, target: UploadTarget) => void | Promise<void>
  /** Allowed types, exact (`image/png`) or a family (`image/*`). Shown as a hint. */
  accept?: string[]
  /** Largest file in bytes. Shown as a hint; the server enforces it. */
  maxBytes?: number
  multiple?: boolean
  label?: string
  transport?: UploadTransport
  className?: string
}

function formatBytes(n: number) {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

function typeHint(accept: string[]) {
  return accept
    .map((t) => (t.endsWith("/*") ? t.slice(0, -2) : (t.split("/")[1] ?? t)).toUpperCase())
    .join(", ")
}

function allowed(file: File, accept?: string[]) {
  if (!accept?.length) return true
  return accept.some((a) =>
    a.endsWith("/*") ? file.type.startsWith(a.slice(0, -1)) : a === file.type,
  )
}

/** Drag-and-drop or pick files, upload each with progress, retry a failed one. */
function Upload({
  getTarget,
  onUploaded,
  accept,
  maxBytes,
  multiple = false,
  label = "Drop a file here or choose one",
  transport = xhrUpload,
  className,
}: UploadProps) {
  const inputId = useId()
  const hintId = useId()
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const patch = useCallback((id: string, p: Partial<Item>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)))
  }, [])

  const send = useCallback(
    async (item: Item) => {
      patch(item.id, { status: "uploading", progress: 0, error: undefined })
      try {
        const target = await getTarget(item.file)
        await transport(
          item.file,
          target,
          (f) => patch(item.id, { progress: Math.round(f * 100) }),
          new AbortController().signal,
        )
        await onUploaded?.(item.file, target)
        patch(item.id, { status: "done", progress: 100 })
      } catch (e) {
        patch(item.id, { status: "error", error: e instanceof Error ? e.message : String(e) })
      }
    },
    [getTarget, onUploaded, transport, patch],
  )

  const add = useCallback(
    (files: FileList | File[]) => {
      const picked = [...files].slice(0, multiple ? undefined : 1)
      const rejected: string[] = []
      const fresh: Item[] = []
      for (const file of picked) {
        if (!allowed(file, accept)) rejected.push(`${file.name}: type not allowed`)
        else if (maxBytes && file.size > maxBytes)
          rejected.push(`${file.name}: over ${formatBytes(maxBytes)}`)
        else fresh.push({ id: crypto.randomUUID(), file, progress: 0, status: "uploading" })
      }
      setNotice(rejected.join(". "))
      if (!fresh.length) return
      setItems((list) => (multiple ? [...list, ...fresh] : fresh))
      for (const item of fresh) void send(item)
    },
    [accept, maxBytes, multiple, send],
  )

  const hint = [
    accept?.length ? typeHint(accept) : "",
    maxBytes ? `up to ${formatBytes(maxBytes)}` : "",
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <div data-slot="upload" className={cn("flex flex-col gap-3", className)}>
      <section
        aria-label="Upload"
        data-dragging={dragging || undefined}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer?.files?.length) add(e.dataTransfer.files)
        }}
        className={cn(
          "flex flex-col items-center gap-1 rounded-lg border border-dashed border-border-default bg-bg-surface px-4 py-6 text-center transition-colors",
          "focus-within:border-ring data-[dragging]:border-primary data-[dragging]:bg-bg-elevated",
        )}
      >
        <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-text-primary">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-xs text-text-muted">
            {hint}
          </p>
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="sr-only"
          multiple={multiple}
          accept={accept?.join(",")}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files)
            e.target.value = ""
          }}
        />
      </section>
      <p role="status" aria-live="polite" className="text-xs text-accent-red empty:hidden">
        {notice}
      </p>
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-text-primary">{item.file.name}</span>
                <span className="shrink-0 text-xs text-text-muted tabular-nums">
                  {item.status === "done"
                    ? "Uploaded"
                    : item.status === "error"
                      ? "Failed"
                      : `${item.progress}%`}
                </span>
              </div>
              <Progress value={item.progress} aria-label={`Uploading ${item.file.name}`} />
              {item.status === "error" ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-accent-red">{item.error}</span>
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={`Retry ${item.file.name}`}
                    onClick={() => void send(item)}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export type { UploadProps }
export { Upload }
