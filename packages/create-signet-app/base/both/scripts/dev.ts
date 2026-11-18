/// <reference types="bun" /> // @bun
// `dev`: the API (restarting on change) and Vite, which proxies /api to it.
// A script rather than `a & b` so it runs the same on Windows; when either
// stops, so does the other.
// bun:begin
const bun = process.execPath
const procs = [
  Bun.spawn([bun, "--watch", "api/server.ts"], { stdio: ["inherit", "inherit", "inherit"] }),
  Bun.spawn([bun, "x", "vite"], { stdio: ["inherit", "inherit", "inherit"] }),
]
const stop = () => {
  for (const p of procs) p.kill()
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
const code = await Promise.race(procs.map((p) => p.exited))
stop()
process.exit(code)
// bun:end
// !bun:begin
import { spawn } from "node:child_process"
import { join } from "node:path"

const self = process.execPath // node or deno, whichever runs this
const api = ["--env-file-if-exists=.env", "--watch", "api/server.ts"] // @node
const api = ["run", "-A", "--env-file=.env", "--watch", "api/server.ts"] // @deno
const vite = join("node_modules", "vite", "bin", "vite.js") // @node
const vite = ["run", "-A", join("node_modules", "vite", "bin", "vite.js")] // @deno
const procs = [
  spawn(self, api, { stdio: "inherit" }),
  spawn(self, [vite], { stdio: "inherit" }), // @node
  spawn(self, vite, { stdio: "inherit" }), // @deno
]
const stop = () => {
  for (const p of procs) p.kill()
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
const code = await Promise.race(
  procs.map((p) => new Promise<number>((done) => p.on("exit", (c) => done(c ?? 0)))),
)
stop()
process.exit(code)
// !bun:end
