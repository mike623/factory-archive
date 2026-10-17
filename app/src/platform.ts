// platform.ts — thin bridge to the host: Tauri in the desktop app, HTTP on the share page; browser fallbacks under `npm run dev`
import { invoke, isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

/** Opened in a browser from the host's share server: the same app, on the host's blueprints. */
export const isWeb = !isTauri() && !!document.querySelector('meta[name="fa-web"]');

/**
 * The desktop app is a host (its own game folder, shared on the LAN) or a client (another PC's library,
 * through that PC's share server). Only Windows has the game, so other systems are always clients.
 */
export type AppMode = 'host' | 'client';
const MODE_KEY = 'fa-mode';
export const canHost = isTauri() && /Windows/.test(navigator.userAgent);
export const appMode: AppMode = !isTauri() || (canHost && (() => { try { return localStorage.getItem(MODE_KEY) !== 'client'; } catch { return true; } })())
  ? 'host' : 'client';
export const isClient = isTauri() && appMode === 'client';
/** Working on another PC's library (client app or share page): host-only features are hidden. */
export const remote = isWeb || isClient;
/** Real files (the desktop app, or a host through the share server) rather than sample data. */
export const hasHost = () => isTauri() || isWeb;

/** Switch this PC between host and client (Windows only). Restarts the window. */
export async function setAppMode(mode: AppMode) {
  if (mode === 'client') await shareStop().catch(() => {}); // a client doesn't share its own folder
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  location.reload();
}

/* client mode: which host this app works on (set by ClientGate before the library loads) */
/** outdated: an older Factory Archive is sharing there; it must be updated before it can be joined */
export interface FoundHost { url: string; name: string; version: string; outdated: boolean }
let hostUrl: string | null = null;
export const setHostUrl = (url: string | null) => { hostUrl = url; };
export const discoverHosts = () => invoke<FoundHost[]>('discover_hosts');
export const hostHello = (url: string) => invoke<FoundHost>('host_hello', { url });

/** Run a library command: `invoke` on a host, through the host's share server on a client or the share page. */
export async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isClient) {
    if (!hostUrl) throw new Error('Not connected to a host yet.');
    return invoke<T>('host_call', { url: hostUrl, cmd, args });
  }
  if (isTauri()) return invoke<T>(cmd, args);
  const res = await fetch(`/api/call/${cmd}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `The host didn't answer (${res.status})`);
  return body as T;
}

/**
 * Save a blueprint's files from the host to this computer: the client app puts them in Downloads
 * (and returns that folder), the share page lets the browser download them.
 */
export async function downloadBlueprint(session: string, name: string, hasCfg: boolean): Promise<string | null> {
  if (isClient) return invoke<string>('host_download', { url: hostUrl, session, name, hasCfg });
  for (const ext of hasCfg ? ['sbp', 'sbpcfg'] : ['sbp']) {
    const a = document.createElement('a');
    a.href = `/api/file/${encodeURIComponent(session)}/${encodeURIComponent(`${name}.${ext}`)}`;
    a.download = `${name}.${ext}`;
    a.click();
  }
  return null;
}

/** Share page: the browser's file picker for .sbp / .sbpcfg files (empty if cancelled). */
export function pickFilesInBrowser(): Promise<File[]> {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.sbp,.sbpcfg' });
    input.onchange = () => resolve([...(input.files ?? [])].filter(f => isBlueprintFile(f.name)));
    input.click();
  });
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function openExternal(url: string) {
  if (isTauri()) openUrl(url).catch(console.error);
  else window.open(url, '_blank', 'noopener');
}

export interface GameFolder {
  kind: 'native' | 'custom';
  label: string;
  path: string;
  /** whether the game's FactoryGame data folder exists there */
  found: boolean;
}

/** Shown in the browser preview, mirroring the Windows default. */
const PREVIEW_FOLDERS: GameFolder[] = [
  { kind: 'native', label: 'Windows', path: '%LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames\\blueprints', found: true },
];

/**
 * Blueprint roots Satisfactory uses on this machine, best match first:
 * the Windows profile folder.
 */
export async function findGameFolders(): Promise<GameFolder[]> {
  if (!hasHost()) return PREVIEW_FOLDERS;
  try { return await call<GameFolder[]>('game_folders'); } catch (e) { console.error(e); return []; }
}

/** Let the user point at a blueprints folder by hand (e.g. a copy synced from another PC). */
export async function pickGameFolder(): Promise<GameFolder | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ directory: true, title: 'Choose the Satisfactory blueprints folder' });
  return typeof path === 'string' ? { kind: 'custom', label: 'Custom folder', path, found: true } : null;
}

/** Shorten a long path to its last few segments: …\FactoryGame\Saved\SaveGames\blueprints */
export function tailPath(p: string, segments = 4) {
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length <= segments ? p : '…' + sep + parts.slice(-segments).join(sep);
}

/* ---------- share with players (LAN web page served by the host app) ---------- */

export interface ShareInfo { port: number; urls: string[]; root: string }
export interface SharedImport { name: string; session: string }

export const canShare = () => isTauri() && !remote;

export async function shareStart(root: string): Promise<ShareInfo> {
  return invoke<ShareInfo>('share_start', { root });
}
export async function shareStop(): Promise<void> {
  if (isTauri()) await invoke('share_stop');
}
export async function shareStatus(): Promise<ShareInfo | null> {
  return isTauri() ? invoke<ShareInfo | null>('share_status') : null;
}
/** Fires when a player adds a blueprint through the share page. Returns an unsubscribe function. */
export async function onSharedImport(cb: (e: SharedImport) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<SharedImport>('share-imported', e => cb(e.payload));
}

export interface SessionsInfo {
  detected: { name: string; source: 'autosave' | 'blueprints' } | null;
  pinned: string | null;
  sessions: string[];
}
export async function listSessions(root: string): Promise<SessionsInfo> {
  if (!hasHost()) return { detected: { name: 'Preview World', source: 'autosave' }, pinned: null, sessions: ['Preview World', 'Old World'] };
  return call<SessionsInfo>('sessions', { root });
}
/** Pin friends' imports to one session; null follows the detected current world. */
export async function shareSetSession(name: string | null): Promise<void> {
  if (isTauri()) await invoke('share_set_session', { name });
}

/** Open the blueprints folder, or a session folder inside it, in Explorer / Finder. */
export async function openFolder(root: string, session?: string | null): Promise<void> {
  if (!isTauri()) throw new Error('Opening folders works in the desktop app');
  await invoke<string>('open_folder', { root, session: session ?? null });
}

/* ---------- adding and copying real blueprint files ---------- */

export interface Outcome { name: string; ok: boolean; error: string | null }

/** Native file picker for .sbp / .sbpcfg files; returns absolute paths (empty if cancelled). */
export async function pickBlueprintFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ multiple: true, title: 'Add blueprint files',
    filters: [{ name: 'Satisfactory blueprint', extensions: ['sbp', 'sbpcfg'] }] });
  return Array.isArray(picked) ? picked : picked ? [picked] : [];
}

export async function importFiles(root: string, session: string, paths: string[]): Promise<Outcome[]> {
  return invoke<Outcome[]>('import_files', { root, session, paths });
}

/** Files dropped onto the window (read in the page, sent as bytes). */
export async function importDropped(root: string, session: string, files: File[]): Promise<Outcome[]> {
  const payload = await Promise.all(files.map(async f => [f.name, Array.from(new Uint8Array(await f.arrayBuffer()))] as const));
  return call<Outcome[]>('import_bytes', { root, session, files: payload });
}

export async function copyBlueprints(root: string, items: [session: string, name: string][], target: string): Promise<Outcome[]> {
  return call<Outcome[]>('copy_blueprints', { root, items, target });
}

/** Rename a blueprint's .sbp (and .sbpcfg) inside its world session. Refuses to overwrite. */
export async function renameBlueprint(root: string, session: string, from: string, to: string): Promise<void> {
  await call('rename_blueprint', { root, session, from, to });
}

/** Move a blueprint's .sbp (and .sbpcfg) to the system Trash / Recycle Bin. */
export async function deleteBlueprint(root: string, session: string, name: string): Promise<void> {
  await call('delete_blueprint', { root, session, name });
}

/** Yes/no question: a native dialog in the desktop app, `confirm()` in the browser preview. */
export async function confirmAction(message: string, title: string, okLabel: string): Promise<boolean> {
  if (!isTauri()) return confirm(message);
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(message, { title, kind: 'warning', okLabel, cancelLabel: 'Cancel' });
}

/** Re-read page details and pictures of every blueprint imported from a link. Game files are untouched. */
export async function refetchDetails(): Promise<{ updated: number; failed: number }> {
  return call('refetch_details');
}

export const isBlueprintFile = (name: string) => /\.(sbp|sbpcfg)$/i.test(name);

/* ---------- the game's blueprint categories (written as a new save, never over an existing one) ---------- */

/** "" is the game's Undefined category / sub-category. */
export interface CategoryView { name: string; subs: { name: string; blueprints: string[] }[] }
export type CategoryEdit =
  | { op: 'addCategory'; name: string }
  | { op: 'renameCategory'; from: string; to: string }
  | { op: 'deleteCategory'; name: string }
  | { op: 'addSub'; category: string; name: string }
  | { op: 'renameSub'; category: string; from: string; to: string }
  | { op: 'deleteSub'; category: string; name: string }
  | { op: 'move'; blueprint: string; category: string; sub: string };

/** The world's categories with `edits` applied in memory. Nothing is written. */
export async function categoryTree(root: string, session: string, edits: CategoryEdit[]): Promise<CategoryView[]> {
  if (!hasHost()) {
    if (edits.length) throw new Error('Editing categories works in the desktop app');
    return [{ name: '', subs: [{ name: '', blueprints: [] }] }, { name: 'Production', subs: [{ name: 'Steel', blueprints: [] }] }];
  }
  return call<CategoryView[]>('category_tree', { root, session, edits });
}

/** Write the edits into a new save next to the world's newest one. Returns the new file's name. */
export async function editCategories(root: string, session: string, edits: CategoryEdit[]): Promise<string> {
  if (!hasHost()) throw new Error('Editing categories works in the desktop app');
  return call<string>('edit_categories', { root, session, edits });
}

/** Last report from the Factory Archive Live mod; null if it never ran with this folder. */
export interface ModStatus { version: string; session: string; loaded: number; ageSecs: number }
export async function modStatus(root: string): Promise<ModStatus | null> {
  return isTauri() ? invoke<ModStatus | null>('mod_status', { root }) : null;
}

export interface ModInstall { version: string; path: string; sml: boolean }
/** bundled: the mod version shipped with the app; game: first Satisfactory install found; installed: the mod version in it */
export interface LiveModState { bundled: string | null; game: string | null; installed: string | null }
export async function liveModState(): Promise<LiveModState | null> {
  return isTauri() ? invoke<LiveModState>('live_mod_state') : null;
}
/**
 * Install or update the Live mod: from the zip bundled with the app, or (fromZip) one the user picks.
 * Goes into the Steam / Epic install found on this PC, or a folder the user picks. Null if cancelled.
 */
export async function installLiveMod(fromZip: boolean): Promise<ModInstall | null> {
  if (!isTauri()) throw new Error('Installing the mod needs the desktop app.');
  const { open } = await import('@tauri-apps/plugin-dialog');
  let zip: string | null = null;
  if (fromZip) {
    const z = await open({ title: 'Choose the Factory Archive Live zip', filters: [{ name: 'Mod zip', extensions: ['zip'] }] });
    if (typeof z !== 'string') return null;
    zip = z;
  }
  const found = await invoke<string[]>('game_installs');
  // ponytail: first install found wins; pick by hand for a second copy or a dedicated server
  const game = found[0] ?? await open({ directory: true, title: 'Choose your Satisfactory install folder' });
  if (typeof game !== 'string') return null;
  return invoke<ModInstall>('install_live_mod', { zip, game });
}

/** Ask, then remove the Live mod from the game it was found in. False if cancelled. */
export async function uninstallLiveMod(game: string): Promise<boolean> {
  const { ask } = await import('@tauri-apps/plugin-dialog');
  if (!await ask(`Remove the Factory Archive Live mod from ${game}? SML and your other mods stay. Close the game first.`,
    { title: 'Uninstall Live mod', kind: 'warning', okLabel: 'Uninstall' })) return false;
  await invoke('uninstall_live_mod', { game });
  return true;
}

/* ---------- moving a world to another Steam / Epic account on this PC ---------- */

/** save: the world's newest save file (the one the category editor reads), on the account that has it */
export interface SaveAccount { id: string; hasWorld: boolean; name: string | null; save: string | null }
/** Account save folders on this PC, and which one holds the world's newest save. */
export async function saveAccounts(root: string, session: string): Promise<SaveAccount[]> {
  return isTauri() && !remote ? invoke<SaveAccount[]>('save_accounts', { root, session }) : [];
}
/** Copy the world's newest save into `account`'s save folder. Returns the file's name. */
export async function copySaveToAccount(root: string, session: string, account: string): Promise<string> {
  return invoke<string>('copy_save_to_account', { root, session, account });
}
