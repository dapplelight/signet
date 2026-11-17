import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { Arm, ArmId, Task } from "./types"

export const ROOT = resolve(import.meta.dir, "../..")
/** The built MCP server. dist is gitignored, so `bun run build:all` must have run. */
export const MCP_BIN = join(ROOT, "packages/mcp/dist/bin.js")
const LLMS_TXT = "https://signet.dapplelight.in/llms.txt"

/** The same prompt goes to every arm. What differs is the folder, the tools and the notes the agent finds there. */
export const ARMS: Record<ArmId, Arm> = {
  A: {
    id: "A",
    label: "Vite, React and Tailwind, shadcn allowed",
    mcp: false,
    denyTools: [],
    check: false,
  },
  B: {
    id: "B",
    label: "Signet, MCP server and llms.txt",
    mcp: true,
    denyTools: ["mcp__signet__plan_page"],
    check: true,
  },
  C: {
    id: "C",
    label: "B plus blocks, plan_page, check and --describe",
    mcp: true,
    denyTools: [],
    check: true,
  },
}

/** Names the problem with an arm, or null. */
export function validateArm(a: Arm | undefined, id: string): string | null {
  if (!a) return `arm ${id}: id: unknown arm; use ${Object.keys(ARMS).join(", ")}`
  if (a.id !== id) return `arm ${id}: id: must equal the key`
  if (!a.label.trim()) return `arm ${id}: label: must not be empty`
  if (a.denyTools.length && !a.mcp) return `arm ${id}: denyTools: needs mcp`
  if (a.check && !a.mcp) return `arm ${id}: check: scored only for Signet arms`
  return null
}

const write = (dir: string, file: string, text: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), text)
}

/** Notes for arm A: the usual stack an agent reaches for without Signet. */
export const notesA = `# Notes

This app uses React and Tailwind CSS v4 (already set up in src/index.css).

- Style with Tailwind utility classes. Make it look like a polished, modern product.
- You may add shadcn/ui components with \`npx shadcn@latest\` if you want them.
`

/**
 * Files for a Vite + React + TypeScript app with Tailwind v4: what an agent would
 * start from without Signet. No Signet anywhere; shadcn/ui is allowed (see notesA).
 */
export function plainApp(): Record<string, string> {
  return {
    "package.json": `${JSON.stringify(
      {
        name: "app",
        private: true,
        type: "module",
        scripts: {
          dev: "vite --port 5173",
          build: "tsc --noEmit && vite build",
          typecheck: "tsc --noEmit",
        },
        dependencies: { react: "^19.1.0", "react-dom": "^19.1.0" },
        devDependencies: {
          "@types/react": "^19.1.0",
          "@types/react-dom": "^19.1.0",
          "@tailwindcss/vite": "^4.1.0",
          "@vitejs/plugin-react": "^5.0.0",
          tailwindcss: "^4.1.0",
          typescript: "^5.9.0",
          vite: "^7.1.0",
        },
      },
      null,
      2,
    )}\n`,
    "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
    "vite.config.ts": `import tailwindcss from "@tailwindcss/vite"\nimport react from "@vitejs/plugin-react"\nimport { defineConfig } from "vite"\n\nexport default defineConfig({ plugins: [react(), tailwindcss()] })\n`,
    "src/index.css": `@import "tailwindcss";\n`,
    "CLAUDE.md": notesA,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: ["vite/client"],
        },
        include: ["src", "vite.config.ts"],
      },
      null,
      2,
    )}\n`,
    "src/main.tsx": `import "./index.css"\nimport { createRoot } from "react-dom/client"\nimport { App } from "./App"\n\ncreateRoot(document.getElementById("root") as HTMLElement).render(<App />)\n`,
    "src/App.tsx": `export function App() {\n  return <main>Hello</main>\n}\n`,
  }
}

const mcpConfig = () =>
  `${JSON.stringify({ mcpServers: { signet: { command: "bun", args: [MCP_BIN] } } }, null, 2)}\n`

/** Notes for arm B: the docs and the MCP lookups, nothing from the page-building loop. */
export const notesB = `# Notes

This app uses Signet components and tokens.

- The docs index for agents is ${LLMS_TXT}. Fetch it to find a page.
- The \`signet\` MCP server is connected. Use search_docs, read_doc, list_components, get_component and compose_component.
- Use only Signet components and token classes. Do not hard-code colours.
`

/** Notes for arm C: the plan, blocks, plan_page and check. */
export const notesC = `# Notes

This app uses Signet components and tokens. PLAN.md lists the pages to build and AGENTS.md says how.

- Read AGENTS.md and PLAN.md first, then build the pages in the plan's build order.
- The docs index for agents is ${LLMS_TXT}.
- The \`signet\` MCP server is connected. Call plan_page for a page the plan does not cover.
- Add blocks with \`bun ${join(ROOT, "packages/cli/src/index.ts")} add block <name>\`.
- Before you finish, run \`bun ${join(ROOT, "packages/cli/src/index.ts")} check\` and fix every error it prints.
`

async function sh(cmd: string[], cwd: string) {
  const p = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  })
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ])
  if (code !== 0)
    throw new Error(
      `${cmd.slice(0, 3).join(" ")} exited ${code}: ${(err || out).trim().split("\n").pop()}`,
    )
}

/** A fresh app for one run in <dir>/app. Throws with the failing command named. */
export async function scaffold(arm: ArmId, task: Task, dir: string): Promise<string> {
  const app = join(dir, "app")
  if (arm === "A") for (const [f, text] of Object.entries(plainApp())) write(app, f, text)
  else {
    const cli = join(ROOT, "packages/create-signet-app/src/index.ts")
    const args =
      arm === "B"
        ? ["--template", "web", "--pm", "bun"]
        : ["--template", "web", "--pm", "bun", "--describe", task.describe]
    await sh(["bun", cli, "app", ...args], dir)
    write(app, ".mcp.json", mcpConfig())
    write(app, "CLAUDE.md", arm === "B" ? notesB : notesC)
  }
  await sh(["bun", "install"], app)
  return app
}
