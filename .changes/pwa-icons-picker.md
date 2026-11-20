### create-signet-app: PNG icons in the PWA part, shorter picker command

The pwa part now ships 192px, 512px and maskable 512px PNG icons next to the SVG, listed in the manifest and the service worker's precache, so phones that ignore SVG home-screen icons get one. Scaffolding skips PNGs when resolving markers and placeholders, so they are copied byte for byte. The picker's equivalent command lists only the parts you chose, not ones added because another part needs them; it resolves to the same app.
