import { createRouter, type RouterHistory } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

// routeTree.gen.ts is generated from src/routes by the router plugin in
// vite.config.ts on every `dev` and `build`. It is committed so `tsc` can
// typecheck before Vite has run; do not edit it by hand.

/** A history argument is for tests; the app uses the browser's. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultPreload: "intent" })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
