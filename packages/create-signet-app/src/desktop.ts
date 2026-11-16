/** The desktop template (Tauri v2): its package.json and the app id derived from the name. */

/**
 * Lowercase alphanumerics only, starting with a letter: valid in a reverse-domain
 * identifier segment and as a Cargo crate name. "My App!" -> "myapp".
 */
export function appId(name: string): string {
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, "")
  return /^[a-z]/.test(id) ? id : `app${id}`
}

export const DESKTOP_PKG = {
  scripts: {
    dev: "vite",
    build: "tsc --noEmit && vite build",
    preview: "vite preview",
    tauri: "tauri",
    lint: "biome check .",
    format: "biome check --write .",
    typecheck: "tsc --noEmit",
    test: "bun test src",
  },
  dependencies: {
    "@dapplelight/signet-lib": "^0.4.1",
    "@dapplelight/signet-tokens": "^0.4.0",
    "@dapplelight/signet-ui": "^0.3.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-opener": "^2.0.0",
    "@tauri-apps/plugin-store": "^2.0.0",
    "class-variance-authority": "^0.7.1",
    clsx: "^2.1.1",
    "lucide-react": "^1.47.0",
    react: "^19.3.0",
    "react-dom": "^19.3.0",
    "tailwind-merge": "^3.7.0",
  },
  devDependencies: {
    "@biomejs/biome": "^2.5.14",
    "@tailwindcss/vite": "^4.3.3",
    "@tauri-apps/cli": "^2.0.0",
    "@types/bun": "^1.4.2",
    "@types/node": "^26.6.2",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    tailwindcss: "^4.3.3",
    typescript: "^7.0.2",
    vite: "^8.3.0",
  },
}
