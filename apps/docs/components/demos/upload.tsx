"use client"
import { Upload, type UploadTransport } from "@dapplelight/signet-ui/domain/upload"

// A stand-in for the real upload: counts to 100 over about a second.
const fakeTransport: UploadTransport = (file, _target, onProgress) =>
  new Promise((resolve, reject) => {
    let done = 0
    const timer = setInterval(() => {
      done += 0.1
      onProgress(Math.min(done, 1))
      if (file.name.includes("fail")) {
        clearInterval(timer)
        reject(new Error("Upload failed (403)"))
      } else if (done >= 1) {
        clearInterval(timer)
        resolve()
      }
    }, 100)
  })

const getTarget = async (file: File) => ({
  url: `https://uploads.example.com/${encodeURIComponent(file.name)}`,
})

export function UploadDemo() {
  return (
    <div className="w-full max-w-md">
      <Upload
        getTarget={getTarget}
        transport={fakeTransport}
        accept={["image/*", "application/pdf"]}
        maxBytes={5 * 1024 * 1024}
      />
    </div>
  )
}

export function UploadMultipleDemo() {
  return (
    <div className="w-full max-w-md">
      <Upload
        multiple
        label="Drop receipts here or choose files"
        getTarget={getTarget}
        transport={fakeTransport}
        accept={["image/png", "image/jpeg"]}
        maxBytes={2 * 1024 * 1024}
      />
    </div>
  )
}

export function UploadConfirmDemo() {
  return (
    <div className="w-full max-w-md">
      <Upload
        getTarget={getTarget}
        transport={fakeTransport}
        onUploaded={async (file) => {
          await new Promise((r) => setTimeout(r, 300))
          console.log(`Confirmed ${file.name}`)
        }}
      />
    </div>
  )
}
