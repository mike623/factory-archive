# Factory Archive — Satisfactory Blueprint Manager

This is the desktop implementation of the **Factory Archive** design in `../project/Factory Archive.html`. It's a Tauri 2 shell (targeting Windows) around a React 19 + TypeScript + Vite frontend.

## Run it on Windows

### Option A — download a built installer (no toolchain needed)

Every push that touches `app/` runs the **Windows build** GitHub Action (`.github/workflows/windows-build.yml`). To install from it:

1. Open the repo on GitHub → **Actions** → **Windows build** → the latest run.
2. Download the `factory-archive-windows` artifact (a zip).
3. Run the `Factory Archive_0.1.0_x64-setup.exe` (NSIS) or the `.msi` inside it. The zip also contains a portable `factory-archive.exe`.

The installer fetches WebView2 if it's missing. Windows 10 and 11 normally have it already.

### Option B — run from source (hot reload)

One-time prerequisites:

- [Node.js 22+](https://nodejs.org/)
- [Rust](https://rustup.rs/) (the default `stable-x86_64-pc-windows-msvc` toolchain)
- **Microsoft C++ Build Tools**: in the Visual Studio Installer, tick *Desktop development with C++*

Then:

```powershell
git clone <this repo>
cd <repo>\app
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
- **Game folder:** the Rust command `blueprint_dir` (`src-tauri/src/lib.rs`) returns the real path, `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\blueprints`. Satisfactory stores blueprints in per-session subfolders under it.

Next steps: persist the library (Tauri store or SQLite), fetch and parse blueprint URLs in Rust, and copy the `.sbp`/`.sbpcfg` pair into the chosen session folder.

## Layout

```
app/
  src/                 React UI (one file per area: library, cards, detail, modals, empty)
    styles.css         design tokens — dark default, html[data-theme="light"] overrides
    platform.ts        Tauri bridge with browser fallbacks
  src-tauri/           Rust shell, window config, Windows bundle settings, icons
```
