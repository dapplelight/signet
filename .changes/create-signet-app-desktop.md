### create-signet-app: desktop template (Tauri v2)

- New `--template desktop`: a Tauri v2 desktop and menu-bar app. React + Vite webview with Signet's UI and tokens (`--theme`, dark mode), a tray icon that toggles a small window, and a main window that hides to the tray.
- Sign-in is authorization code + PKCE (S256) through the system browser and a one-shot loopback listener in Rust, against signet-server's `clientLoginRoutes`. Tokens go through `createSession` with `tauriStorage` over the official store plugin; the API client is bearer-only (`credentials: "omit"`) with `tokenEndpointRefresh`.
- Official Tauri plugins only (opener, store). The window capability is least privilege, and the identifier is a placeholder (`com.example.<app>`) to replace before shipping.
- The template ships its own CI workflow that lints, typechecks and tests, then builds installers on macOS, Windows and Linux. The Rust is verified there; Signet's tests cover the webview, config and capabilities, not cargo.
