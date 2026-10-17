// platform.ts — thin bridge to the Tauri host; falls back to browser APIs under `npm run dev`
import { invoke, isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

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
  if (!isTauri()) return PREVIEW_FOLDERS;
  try { return await invoke<GameFolder[]>('game_folders'); } catch (e) { console.error(e); return []; }
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

export const canShare = () => isTauri();

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
  if (!isTauri()) return { detected: { name: 'Preview World', source: 'autosave' }, pinned: null, sessions: ['Preview World', 'Old World'] };
  return invoke<SessionsInfo>('sessions', { root });
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
  return invoke<Outcome[]>('import_bytes', { root, session, files: payload });
}

export async function copyBlueprints(root: string, items: [session: string, name: string][], target: string): Promise<Outcome[]> {
  return invoke<Outcome[]>('copy_blueprints', { root, items, target });
}

/** Rename a blueprint's .sbp (and .sbpcfg) inside its world session. Refuses to overwrite. */
export async function renameBlueprint(root: string, session: string, from: string, to: string): Promise<void> {
  await invoke('rename_blueprint', { root, session, from, to });
}

/** Move a blueprint's .sbp (and .sbpcfg) to the system Trash / Recycle Bin. */
export async function deleteBlueprint(root: string, session: string, name: string): Promise<void> {
  await invoke('delete_blueprint', { root, session, name });
}

/** Yes/no question: a native dialog in the desktop app, `confirm()` in the browser preview. */
export async function confirmAction(message: string, title: string, okLabel: string): Promise<boolean> {
  if (!isTauri()) return confirm(message);
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(message, { title, kind: 'warning', okLabel, cancelLabel: 'Cancel' });
}

/** Re-read page details and pictures of every blueprint imported from a link. Game files are untouched. */
export async function refetchDetails(): Promise<{ updated: number; failed: number }> {
  return invoke('refetch_details');
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
  if (!isTauri()) {
    if (edits.length) throw new Error('Editing categories works in the desktop app');
    return [{ name: '', subs: [{ name: '', blueprints: [] }] }, { name: 'Production', subs: [{ name: 'Steel', blueprints: [] }] }];
  }
  return invoke<CategoryView[]>('category_tree', { root, session, edits });
}

/** Write the edits into a new save next to the world's newest one. Returns the new file's name. */
export async function editCategories(root: string, session: string, edits: CategoryEdit[]): Promise<string> {
  if (!isTauri()) throw new Error('Editing categories works in the desktop app');
  return invoke<string>('edit_categories', { root, session, edits });
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
  return isTauri() ? invoke<SaveAccount[]>('save_accounts', { root, session }) : [];
}
/** Copy the world's newest save into `account`'s save folder. Returns the file's name. */
export async function copySaveToAccount(root: string, session: string, account: string): Promise<string> {
  return invoke<string>('copy_save_to_account', { root, session, account });
}
