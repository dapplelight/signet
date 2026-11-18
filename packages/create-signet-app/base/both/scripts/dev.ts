/// <reference types="bun" />
// `dev`: the API (restarting on change) and Vite, which proxies /api to it.
// A script rather than `a & b` so it runs the same on Windows; when either
// stops, so does the other.
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
