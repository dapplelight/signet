### create-signet-app: installed apps launch on the theme colour

- The web template's install manifest now sets `background_color` and `theme_color` from the chosen theme's `--background` (cinematic launches dark, editorial and finance light), so an app added to a phone home screen opens on its own colour instead of a white flash.
- `index.html` adds a `theme-color` meta for light and dark, an icon link and `apple-touch-icon`.
- `public/` ships neutral placeholder icons (192, 512, maskable 512, apple-touch 180); replace them with your own at the same sizes.
