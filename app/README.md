# Factory Archive — Satisfactory Blueprint Manager

This is the desktop implementation of the **Factory Archive** design in `../project/Factory Archive.html`. It's a Tauri 2 app around a React 19 + TypeScript + Vite frontend, for **Windows** and for **macOS with the game running under CrossOver**.

## Where it looks for the game

| Platform | Blueprints folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\blueprints` |
| macOS + CrossOver | `~/Library/Application Support/CrossOver/Bottles/<bottle>/drive_c/users/<user>/AppData/Local/FactoryGame/Saved/SaveGames/blueprints` |

On macOS the app scans every CrossOver bottle and lists each one that has Satisfactory data. A bottle is an ordinary folder, so the app can read and write it directly. If you keep bottles somewhere custom, click the folder card in the sidebar, or **Change…** in the export drawer, to choose the folder by hand. The app remembers your choice.

**After exporting, reload your save.** Satisfactory reads blueprint files when a save loads, so new or updated blueprints show up after you go to the main menu and load the save again. You don't need to restart the whole game. Avoid saving over the same blueprint in-game while exporting, or the game may write its own copy over yours.

Satisfactory keeps blueprints in one subfolder per save session, under the folder above.

## Get a build

Every push that touches `app/` runs the **Desktop build** GitHub Action (`.github/workflows/desktop-build.yml`). It builds:

- **`factory-archive-windows`:** the NSIS `…_x64-setup.exe` and an `.msi`. The installer fetches WebView2 if it's missing.
- **`factory-archive-macos`:** a universal `.dmg` that runs on Apple Silicon and Intel, macOS 11+.

Download them from GitHub → **Actions** → **Desktop build** → the latest run → **Artifacts**.

The macOS build isn't signed or notarized, so on first launch macOS will say it "can't be opened". Either right-click the app → **Open** → **Open**, or run:

```bash
xattr -dr com.apple.quarantine "/Applications/Factory Archive.app"
```

## Run from source (hot reload)

One-time prerequisites:

- [Node.js 22+](https://nodejs.org/) and [Rust](https://rustup.rs/)
- **Windows:** Microsoft C++ Build Tools. In the Visual Studio Installer, tick *Desktop development with C++*.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)

Then:

```bash
cd app
npm install
npm run tauri dev      # opens the desktop window with hot reload
npm run tauri build    # produces installers in src-tauri\target\release\bundle\
```

To iterate on the UI in a plain browser without Rust, run `npm run dev` and open http://localhost:1420.

## What's implemented

All screens from the design, with both light and dark themes:

| Screen | Notes |
| --- | --- |
| Library (grid + list) | Live search (Ctrl+K), sort, select cards, floating selection bar |
| Filter rail | Category, tags (match all), modded / has .sbpcfg / installed toggles, game version |
| Sidebar | Library, Import Queue, Recent and Favorites views. Source filter, game-folder status, theme toggle |
| Blueprint detail | Gallery with camera strip (drop an image on the hero to replace it), specs, file pair, source link, export card |
| Import from URL | Detects SCIM, Satisfactory Blueprints or a direct `.sbp` URL, shows a 4-step resolve, then a preview. **Add to library** puts it in Import Queue |
| Batch export drawer | Shows the target folder and copy progress, and marks the exported items *Installed* |
| First-run empty state | Shown when the library is empty. Preview it in the browser at `?empty` |

Changes from the prototype: the fake macOS window frame, the scale-to-fit stage, the "Library / First-run" demo switch and the Claude Design Tweaks panel are gone. The app fills the native window, and the theme toggle sits in the sidebar footer and is remembered.

## Still mocked

- **Library data** is the sample set in `src/data.ts`. It lives in memory and resets on restart.
- **Import resolve** returns a fixed preview (`mockResolve` in `src/modals.tsx`).
- **Export** simulates copy progress. It doesn't write any files yet.
- **Game folder detection is real.** The Rust command `game_folders` in `src-tauri/src/lib.rs` returns the Windows folder or the CrossOver bottles, and its unit tests run with `cargo test`.

Next steps: persist the library (Tauri store or SQLite), fetch and parse blueprint URLs in Rust, and copy the `.sbp`/`.sbpcfg` pair into the chosen session folder.

## Layout

```
app/
  src/                 React UI (one file per area: library, cards, detail, modals, empty)
    styles.css         design tokens — dark default, html[data-theme="light"] overrides
    platform.ts        Tauri bridge with browser fallbacks
  src-tauri/           Rust shell, window config, Windows bundle settings, icons
```
