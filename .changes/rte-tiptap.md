### signet-ui: RichTextEditor on Tiptap

- `./components/rich-text-editor` is now built on Tiptap v3 instead of `document.execCommand`. New optional peer dependencies (all MIT): `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-mention`, `@tiptap/extension-link` (`>=3.34.0 <4`). Install them to use the editor.
- The props, the markdown value, the `@[Name](user:<id>)` mention tokens, the toolbar's ARIA, `labels`, `icons`, `className`/`classNames` and the `data-slot` parts are unchanged. Mentions now use Tiptap's suggestion API; pasted HTML is cleaned by the same allowlist as the value.
- `RichTextEditor` and its helpers leave the main barrel (like `chart`, an optional-peer component): import them from `@dapplelight/signet-ui/components/rich-text-editor`.
