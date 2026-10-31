# Factory Archive

**A desktop blueprint manager for [Satisfactory](https://www.satisfactorygame.com/).** Collect, import, organize and share your `.sbp` blueprints across worlds and with friends.

[![Release](https://img.shields.io/github/v/release/mike623/factory-archive?label=download)](https://github.com/mike623/factory-archive/releases/latest)
[![Desktop build](https://github.com/mike623/factory-archive/actions/workflows/desktop-build.yml/badge.svg)](https://github.com/mike623/factory-archive/actions/workflows/desktop-build.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20(CrossOver%20host%20or%20client)-555)

![Factory Archive library](docs/screenshots/library.png)

## Features

- **Your real blueprint library.** It reads the `.sbp`/`.sbpcfg` files in your game folder and groups them by **world session**. It opens on the world you're currently playing, detected from your latest autosave.
- **Import from a link.** Paste a [SCIM](https://satisfactory-calculator.com/en/blueprints) page, a [Satisfactory Blueprints](https://satisfactoryblueprints.com/) page or a direct `.sbp` URL, and the blueprint is downloaded straight into your world. The page's **picture, title, description, author, tags and source link** are saved alongside it.
- **Blueprint breakdown.** See the size, **material cost** and **buildings** (e.g. 3 × Foundry, 16 × Conveyor Belt Mk.4) of any blueprint, read from the `.sbp` file itself. It works for every blueprint, wherever it came from, and works offline.
- **Add files from disk.** Use **Browse**, or drag `.sbp`/`.sbpcfg` files anywhere onto the window.
- **Copy blueprints between worlds**, e.g. bring your favorites into a new save.
- **Share on LAN** for multiplayer. Friends on your network open the app itself in their browser, working on your blueprints: browse, download, add, rename, delete, copy between worlds and edit categories.
- **Sync to your own WebDAV storage** (InfiniCLOUD, Nextcloud, Synology, your own server). Blueprints are uploaded, read back and checked, so a broken upload is reported instead of counted; files you delete or rename here are removed there too.
- **Client mode.** Any app switched to client mode (and Macs without local game data) finds a host sharing on your network and joins it on its own, so you manage the host's blueprints from your own app.
- **Installs the Live mod for you.** Releases include the companion mod: click **Install Live mod** (or **Update Live mod**) in the sidebar and the app puts it in your Steam or Epic game's `Mods` folder. You can also pick a downloaded `FactoryArchiveLive.zip`. **Uninstall Live mod** removes it again (SML and other mods stay).
- **Updates itself.** Signed releases come from GitHub, with an **Install & restart** banner and a **Check for updates** button.
- Search (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>), filters, favorites, grid and list views, and light and dark themes.

| Blueprint details | Import from a link |
| --- | --- |
| ![Detail page](docs/screenshots/detail.png) | ![Import dialog](docs/screenshots/import.png) |

## Download

Get the latest installer from **[Releases](https://github.com/mike623/factory-archive/releases/latest)**:

| Platform | File |
| --- | --- |
| Windows 10/11 | `Factory.Archive_<version>_x64-setup.exe` (or the `.msi`) |
| macOS 11+ (Apple Silicon & Intel) | `Factory.Archive_<version>_universal.dmg` |

Installed copies update themselves after that.

**First launch:** the builds aren't code-signed yet.
- **Windows:** if SmartScreen warns, click **More info → Run anyway**.
- **macOS:** right-click the app → **Open** → **Open**, or run:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Factory Archive.app"
  ```

## Using it

### Where your blueprints live

Satisfactory keeps blueprints **per world (save session)**, in one folder per session:

| Platform | Blueprints folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\blueprints\<session>\` |
| macOS / CrossOver | `~/Library/Application Support/CrossOver/Bottles/<bottle>/drive_c/users/<user>/AppData/Local/FactoryGame/Saved/SaveGames/blueprints/<session>/` |

The app finds this folder automatically. On macOS it checks CrossOver bottles for existing Satisfactory data and starts as a host when found; otherwise it starts as a client. A remembered client choice takes priority. Run the game once before detection. Automatic discovery covers CrossOver’s default Bottles folder. In host mode, click the folder card in the sidebar to choose a folder yourself. The folder button next to it opens the current world's folder in Explorer or Finder.

> **After adding blueprints, reload the save.** Go to the main menu and load the world again; no restart is needed. For a dedicated server, stop the server before copying files in, then start it again.

Good to know:
- A session folder's name must match the session name exactly. A [known bug](https://wiki.indifferentbroccoli.com/Satisfactory/InvisibleBlueprintFix) can hide blueprints when the session name contains spaces or special characters.
- The `.sbp` is the blueprint itself. The `.sbpcfg` only holds its icon and description and is optional.

### Importing from a link

**Import → paste a link → Download & add.** It works with:
- **Direct `.sbp` / `.sbpcfg` links.** The matching sibling file is fetched too.
- **Blueprint pages** (SCIM, Satisfactory Blueprints…). The app follows links on the page that really download a `.sbp`/`.sbpcfg`.

It doesn't depend on any site's page layout, and it never saves an HTML page as a blueprint. If no download is found (for example because the site needs a login), it says so and writes nothing. In that case, download the files in your browser and drop them on the app.

Along with the files, the app saves the page's **picture, title, description, author, tags and link**, read from the page's standard link-preview tags. These are stored in the app's data folder, never in the game folder:
- Windows: `%APPDATA%\com.factoryarchive.app\blueprint-meta\`
- macOS: `~/Library/Application Support/com.factoryarchive.app/blueprint-meta/`

They're keyed by a hash of the blueprint's contents, so they follow it when you copy or rename it.

### Blueprint breakdown

A blueprint's detail page shows what it contains, read directly from its files:
- **Size:** the blueprint's dimensions, as stored in the file.
- **Materials:** the build cost.
- **Buildings:** each building type and how many.
- **Description and color:** the author's description and color from the `.sbpcfg`.

The format was worked out from real Satisfactory 1.0 blueprints (save version 52). Every read is bounds-checked, and the object list is checked against the size the file declares. If a file can't be read, the app says so instead of showing guessed numbers. Names come from a table of in-game names where the internal class name differs (e.g. `Desc_Cement_C` → Concrete); other names are derived from the class name.

### Multiplayer: Share on LAN

Blueprints belong to the world, so in multiplayer they live on the **host's** machine. Players who join a world see the host's blueprints, not their own.

1. The host turns on **Share on LAN** in the sidebar and sends friends the link, e.g. `http://192.168.1.20:7777`. Allow the firewall prompt on **private** networks.
2. Friends open it in any browser and get the same app, working on the host's blueprints folder. They can browse, **download** (instead of *Open folder*), add files or links, rename, delete (to the host's Trash), copy between worlds, edit categories and refetch details. Account and save copies, folder picking and the Live mod stay on the host.
3. The host's window updates and shows what friends added. The host reloads the save to see it in the game.

Instead of a browser, friends can use the app as a **client**. On Windows or a Mac with CrossOver game data, click **Use this PC as a client** under Multiplayer (the choice is remembered). A client searches the local network for a host on ports 7777–7786 and joins the first one it finds, or the last one it used. You can also type the host's address. Downloads go to your Downloads folder. Host and client need the same version.

The page opens on the world that's currently being played, detected from the newest `<session>_autosave_<n>.sav`. The host can pick another one under **Imports go to**.

There's no PIN, so anyone on your network can change your blueprints while sharing is on. Only turn it on at home or over a trusted VPN such as Tailscale or ZeroTier. Other safeguards:
- The server only runs while sharing is on.
- It only runs the library's own commands, always on the shared folder, and rejects path tricks, DNS rebinding and cross-site posts.
- It refuses links that point at your own network.

### Sync your blueprints (WebDAV)

Click **Sync** in the top bar, paste your WebDAV address and a token, and press **Test**, then **Sync now**. Nothing else needs installing: the app speaks WebDAV itself.

- A free option is [InfiniCLOUD](https://infini-cloud.net/en/) (20 GB). Sign up, open **My Page → Apps Connection**, turn it on, and copy the **WebDAV Connection URL**, your **User ID** and the **Apps Password** it shows once. Put the user ID in *Username* and the apps password in *Token*.
- The *Token* field takes either an apps password (with a username, sent as basic auth) or a bearer token (no username). **Auto** tries what fits the fields and says which one the server accepted.
- Everything lives under one reserved folder, `<your address>/.factory-archive/`, as `blueprints/<world>/<name>.sbp`. If that folder already holds other files, the app refuses to write until you tick **Use it anyway**.
- Each upload is downloaded again and compared by SHA-256 before it counts. A run reports "uploaded / already there / failed" per file, and the next run picks up whatever didn't make it.
- Only changed files go up, so a second backup of a large library takes seconds. If the folder already holds a backup — after a reinstall, or from a second PC — files whose content is already there are recognised and skipped instead of uploaded again; a different copy of the same blueprint is overwritten with yours. **Upload everything again** forces a full copy.
- The token is stored in the app's data folder, readable only by you (mode `0600`). It is never shown on its own, never written to logs and never sent to the share page; click the eye next to the field to read it back on this PC. **Forget** deletes it.
### What a sync does with deletions

The server mirrors the folder, with limits, because this is the one place the app removes something:

- A `.sbp`/`.sbpcfg` you delete or rename here leaves `.factory-archive/blueprints/` on the server. Untick **Remove files from the backup that I deleted here** to keep them instead.
- Nothing is removed when your local folder has no blueprints at all — an unplugged drive or a moved game folder is not read as "delete everything".
- Nothing is removed if any upload in the same run failed, so a half-finished sync never becomes a half-deleted one.
- An automatic run may remove at most 50 files; beyond that it says so and waits for a sync you started.
- Empty world folders are left in place, and nothing outside `.factory-archive/blueprints/` is ever touched. Restoring is **Use the cloud copy** in the dialog (below), or copying files out yourself.

### Which version wins

Both sides keep a small state file — `<app data>/backup/backup-index.json` on this PC and `.factory-archive/sync-state.json` on the server — so a reinstall or a second PC can still tell what changed. Opening the dialog compares that with what is actually on both sides (sizes only; no blueprint is downloaded for this) and names the side that moved:

- **Both sides match** — nothing to do.
- **Changes here** — *Sync now* uploads them.
- **Cloud changes** or **both changed** — the differing files are listed and you pick one side for the whole library: *Keep this PC's version* (upload, replacing the cloud copy) or *Use the cloud copy* (download, replacing the local copy).
- **Different folder** — the game is pointing at a folder other than the one this PC last synced. Uploads still work; removals from the cloud stay paused until you tick *I mean this folder*.

*Use the cloud copy* keeps every local file it replaces next to it as `<name>.sbp.bak` / `<name>.sbpcfg.bak` (the game ignores `.bak`), and checks the download against the state file's SHA-256 before writing. Files that only exist here are left alone — that direction never deletes anything on this PC. Reload the save afterwards so the game sees the restored blueprints.

### Sync automatically

Tick **Sync automatically when the app opens** (after one successful sync) and the app re-checks on start and whenever the window comes back into focus, at most every 5 minutes. It only runs when the blueprint folder has been untouched for 10 seconds, so a blueprint the game is still writing is never uploaded half-finished. When the cloud moved, or both sides did, it stops and shows one notice asking you to pick in the Sync dialog instead of guessing.

## Development

Factory Archive is a [Tauri 2](https://v2.tauri.app/) app: a **Rust** backend with a **React 19 + TypeScript + Vite** frontend.

### Prerequisites

- [Node.js 22+](https://nodejs.org/) and [Rust](https://rustup.rs/) (stable)
- **Windows:** Visual Studio Build Tools with *Desktop development with C++*
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- **Linux** (for development and tests): `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`

### Run

```bash
cd app
npm install
npm run tauri dev     # desktop app with hot reload
npm run dev           # UI only, in the browser at http://localhost:1420 (sample data)
```

Browser-preview helpers: `?empty` shows the first-run screen, and `?disk` previews blueprints as if they came from disk.

### Test and check

```bash
cd app/src-tauri && cargo test     # file handling, link import (local stand-in site), share server, metadata, .sbp parsing
FA_SAMPLE_SBP=/path/to/a.sbp cargo test real_sample -- --nocapture   # optional: parse a real blueprint
cd app && node --test src/platform.test.mjs  # host/client startup decisions
cd app && npx tsc --noEmit         # TypeScript
cd app && npx vite build           # frontend build
```

### Project layout

```
app/
  src/                    React UI
    App.tsx               state, routing, filters, file operations
    library.tsx           sidebar + filter rail
    cards.tsx             top bar, grid cards, list rows
    detail.tsx            blueprint detail page
    modals.tsx            import dialog, export drawer, backup dialog
    copyDrawer.tsx        copy to another world
    diskLibrary.ts        reads the real library from the Rust side
    platform.ts           Tauri bridge with browser fallbacks
    styles.css            design tokens (dark default, light overrides)
  src-tauri/
    src/lib.rs            Tauri commands and app setup
    src/backup.rs         WebDAV sync: settings, upload, removals, state file, cloud restore
    src/blueprints.rs     reading, writing, importing and copying blueprint files; session detection
    src/resolve.rs        link import: download, page links, link-preview tags, safety checks
    src/meta.rs           details and picture store, keyed by .sbp hash
    src/sbp.rs            .sbp/.sbpcfg reader: size, cost, buildings, description
    src/share.rs          Share on LAN web server (serves the app's own UI)
    tauri.conf.json       app config and updater public key
design/                   the original Claude Design prototype and chats
.github/workflows/        CI build and release
```

### Releasing

Bump `version` in `app/src-tauri/tauri.conf.json` (and `app/package.json`) and push to `main`. The **Release** workflow then builds Windows and macOS, signs the update packages, and publishes a GitHub Release with `latest.json`. Versions that already have a release are skipped. You can also push a `v*` tag or run **Release** manually from the Actions tab.

Signing uses the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets. The matching public key is `plugins.updater.pubkey` in `tauri.conf.json`. Use a password of letters and digits only, since symbols get altered on the Windows runner.

## Contributing

Issues and pull requests are welcome.

- Please run `cargo test` and `npx tsc --noEmit` before opening a PR.
- Keep the app honest: never write placeholder or guessed data into the game folder.
- Coding agents should read [`AGENTS.md`](AGENTS.md).

## Roadmap

- Building power use and the breakdown's raw-resource totals, which need game recipe data.
- Code-signed Windows and macOS builds.
- Live refresh in-game without reloading the save. This probably needs a game mod.

## License

[MIT](LICENSE)

## Disclaimer

Factory Archive is a fan-made tool. It is not affiliated with or endorsed by Coffee Stain Studios, [Satisfactory Calculator (SCIM)](https://satisfactory-calculator.com/) or [Satisfactory Blueprints](https://satisfactoryblueprints.com/). Satisfactory is a trademark of Coffee Stain Studios. Blueprints you download belong to their authors, so respect each site's terms.
