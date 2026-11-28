### signet-ui: logo stack

- New `./components/logo-stack`: `LogoStack` shows up to 4 overlapping square project marks (5px corners, a 2px ring in the page colour) and then a "+N" mark. Each mark is `{ src, alt }`; `lightTile` puts a light tile behind a dark mark on a dark page. Built on `Avatar`, so the initials show while an image loads or if it fails. Parts (`LogoStackRoot`, `LogoStackMark`, `LogoStackMore`), `size`, `max`, `classNames` and `data-*` hooks; `signet add logo-stack` copies it in.
