# AGENTS.md

Guidance for AI coding agents (and humans) working on **Factory Archive**, a Tauri 2 desktop app (Rust + React/TypeScript) that manages Satisfactory blueprint files. Read `README.md` for what the app does.

## Commands

Run from the repo root unless noted.

| Task | Command |
| --- | --- |
| Install JS deps | `cd app && npm ci` |
| Typecheck | `cd app && npx tsc --noEmit` |
| Frontend build | `cd app && npx vite build` |
| UI in a browser (sample data) | `cd app && npm run dev` → http://localhost:1420 (`?disk`, `?empty` previews) |
| Rust tests | `cd app/src-tauri && cargo test` |
| Rust compile check | `cd app/src-tauri && cargo check` |
| Desktop app | `cd app && npm run tauri dev` |

On Linux, `cargo check`/`cargo test` need `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`.

Before you finish, run **`npx tsc --noEmit`, `npx vite build` and `cargo test`**, and make sure all three pass. `tsconfig` is strict, with `noUnusedLocals`/`noUnusedParameters`.

## Layout

- `app/src/`: React UI. One file per area: `App.tsx` (state, filters, file actions), `library.tsx` (sidebar, filter rail), `cards.tsx`, `detail.tsx`, `modals.tsx`, `copyDrawer.tsx`, `diskLibrary.ts`, `platform.ts` (all Tauri `invoke` calls, with browser fallbacks).
- `app/src-tauri/src/`: Rust.
  - `lib.rs`: Tauri commands and setup.
  - `blueprints.rs`: blueprint files and world sessions.
  - `resolve.rs`: link import.
  - `meta.rs`: details and picture store.
  - `sav.rs`: reads the game's blueprint categories from a world's `.sav` (read-only).
  - `savedit.rs`: edits those categories by writing a **new** save next to the world's newest one. It never modifies an existing save.
  - `sbp.rs`: `.sbp`/`.sbpcfg` reader (size, cost, buildings, description). The layout is documented at the top of the file; keep its bounds checks and size validation.
  - `share.rs` + `share.html`: the LAN share server and the page it serves.
- `design/`: the original Claude Design prototype. Treat it as reference, not code to edit.
- `.github/workflows/`: `desktop-build.yml` (every push) and `release.yml` (releases).

## Conventions

- **Styling:** inline `style={{…}}` objects using the CSS variables in `app/src/styles.css` (`var(--panel)`, `var(--accent)`…), matching the existing components. No CSS frameworks. Every color must work in both themes; light mode overrides the variables under `html[data-theme="light"]`.
- **Icons:** add stroke icons to `app/src/icons.tsx` in the existing style. Don't add icon packages.
- **Tauri calls** go through `platform.ts` (or a small hook) and must have a sensible browser-preview fallback.
- **Rust:** small modules with unit tests next to the code. Use `tiny_http`-based local servers to test networking; tests must not need the internet.
- Write user-facing text in plain language, and match the tone of the existing UI copy.

## Hard rules

1. **Never write fake, placeholder or guessed data into the game folder.** If a download or parse can't be verified, report a clear error and write nothing. Sample data exists only in the browser preview.
2. **Never overwrite** a blueprint file. `write_blueprint` refuses to, and callers should report "already exists".
3. **Validate every name and path** that comes from the UI, the share page or the web: use `blueprints::valid_component`, and keep the rule that only `.sbp`/`.sbpcfg` files are read or written (and `.sav` files, under rule 6). The one exception is the Live mod's status file, `<blueprints>/FactoryArchiveLive.json`, which the app only reads (`blueprints::mod_status`, size-capped). Folders are opened only if they're directories (`open_folder`).
4. **Share server** (`share.rs`) has no authentication by design. Keep its protections intact: the Host-header check (DNS rebinding), JSON-only POSTs (CSRF), body size limits and path validation. Link imports from it must keep refusing local and private addresses (`resolve::host_allowed`).
5. **Signing keys:** never print, log or commit `TAURI_SIGNING_PRIVATE_KEY` or its password. The public key lives in `tauri.conf.json` → `plugins.updater.pubkey`. Changing it breaks updates for installed copies unless the release secrets change to match.
6. **Saves:** never modify or overwrite an existing `.sav`. Category edits go into a new save file (`savedit::write_edited`, `create_new`), and only after the new bytes read back as intended through `sav.rs`, the independent reader. Anything that doesn't add up is an error and nothing is written. Check changes against real saves with `FA_SAMPLE_SAV`.
7. **Metadata** (pictures, page details) goes in the app data folder via `MetaStore`, never next to the game's files.
8. Don't commit third-party blueprint files as fixtures; build synthetic ones in tests (see `sbp.rs`). To check against a real file, set `FA_SAMPLE_SBP`.
9. Don't scrape site-specific markup you haven't verified. Link import relies only on HTTP facts (file names, `Content-Disposition`, content type) and standard link-preview tags.

## Game facts the code relies on

- Blueprints are stored at `<LocalAppData>/FactoryGame/Saved/SaveGames/blueprints/<session>/<name>.sbp` (+ an optional `.sbpcfg`). On macOS, this is inside CrossOver bottles.
- Blueprint categories / sub-categories live in the world's `.sav` (`mBlueprintCategoryRecords`), not in the blueprint files. Layout taken from public save parsers; check against a real save with `FA_SAMPLE_SAV`. Satisfactory 1.1+ writes the newer (UE 5.4) property tags; `sav.rs` reads both formats.
- Whether the game loads a save edited by `savedit.rs` hasn't been confirmed in-game yet. The header's save-consistency hash is copied unchanged.
- Blueprints belong to the **world** (the host's machine, or the server), not the player.
- The game reads new files when a save **loads**. Reloading the save is enough; this was confirmed by the maintainer.
- Autosaves are named `<session>_autosave_<n>.sav`. This is used to detect the current world and hasn't been verified against every game version.

## Releasing

Bump `version` in `app/src-tauri/tauri.conf.json` **and** `app/package.json` (then `npm install --package-lock-only` in `app/`), and push to `main`. `release.yml` publishes it if that version has no release yet. Don't reuse a version number. Each release must contain `latest.json` and `.sig` files, or updates break.

## Commits

Write a short imperative subject and a body that explains *why*. Keep unrelated changes in separate commits.
