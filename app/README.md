# Factory Archive — Satisfactory Blueprint Manager

This is the desktop implementation of the **Factory Archive** design in `../project/Factory Archive.html`. It's a Tauri 2 app around a React 19 + TypeScript + Vite frontend, for **Windows** and for **macOS with the game running under CrossOver**.

## Where it looks for the game

| Platform | Blueprints folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\blueprints` |
| macOS + CrossOver | `~/Library/Application Support/CrossOver/Bottles/<bottle>/drive_c/users/<user>/AppData/Local/FactoryGame/Saved/SaveGames/blueprints` |

On macOS the app scans every CrossOver bottle and lists each one that has Satisfactory data. A bottle is an ordinary folder, so the app can read and write it directly. If you keep bottles somewhere custom, click the folder card in the sidebar, or **Change…** in the export drawer, to choose the folder by hand. The app remembers your choice.

**Close the game before exporting, then start it again.** Hosting guides and player reports say copying files while the game or server is running can fail, and that blueprints appear after a restart. ([G-Portal](https://www.g-portal.com/wiki/en/satisfactory-importing-and-exporting-blueprints-on-your-server/), [Shockbyte](https://shockbyte.com/help/knowledgebase/articles/how-to-upload-blueprints-to-your-satisfactory-server))

**Blueprints belong to the world, not the player.** Each save session has its own `blueprints\<session name>\` folder on whichever machine runs the world: your PC when you host, the host's PC when you join a friend, or the server for a dedicated server. The folder name must match the session name exactly. A known bug can hide blueprints when the session name has spaces or special characters ([fix guide](https://wiki.indifferentbroccoli.com/Satisfactory/InvisibleBlueprintFix)). The `.sbp` is required; the `.sbpcfg` only holds the icon and description.

Satisfactory keeps blueprints in one subfolder per save session, under the folder above.

## Share with players (multiplayer)

Blueprints live with the host's world, so the host's app can serve a small web page that friends on the **same network** open in any browser. There's no PIN, by design.

1. The host turns on **Share on LAN** in the sidebar and copies the link, e.g. `http://192.168.1.20:7777`.
2. The first time, Windows Defender Firewall or macOS asks whether to allow incoming connections. Allow it on **private** networks.
3. Friends open the link. They can:
   - **Browse and download** the host's blueprints, grouped by world session.
   - **Paste a SCIM or Satisfactory Blueprints link**, which is written straight into the host's world folder. *Not working yet:* the link import isn't built (see below), so the page shows a clear "not available yet" message and writes nothing.
4. The host gets a notification, then loads the session again to see the new blueprint.

**Which world imports go into.** The app picks it automatically:
- First, the world of the newest autosave. Satisfactory names autosaves `<session>_autosave_<n>.sav`, so the session name comes from the file name. That naming is from memory and hasn't been checked against the game.
- Otherwise, the most recently changed blueprint session folder.
- The host can override this with **Imports go to** in the Share panel.

If the world has no blueprint folder yet, it's created on the first import.

The server only runs while sharing is on, and only serves `.sbp`/`.sbpcfg` files from the blueprints folder. It rejects path tricks, requests addressed to a foreign host name (DNS rebinding) and cross-site form posts. Anyone on the same network can still use the page, so only turn sharing on at home or on a trusted VPN such as Tailscale or ZeroTier.

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
- **Link import** isn't built yet. In the app, Import returns a fixed preview (`mockResolve` in `src/modals.tsx`). On the share page, `resolve` in `src-tauri/src/resolve.rs` reports "not available yet" so no fake files are ever written. Neither site documents its download links, so this needs the real pages examined first.
- **Export** simulates copy progress. It doesn't write any files yet.
- **Real and tested (`cargo test`):** the share server (`share.rs`), reading, writing and detecting world sessions (`blueprints.rs`), and source detection (`resolve.rs`).
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
