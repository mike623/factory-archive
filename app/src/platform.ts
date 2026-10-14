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
  kind: 'native' | 'crossover' | 'custom';
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
 * the Windows profile folder, or every CrossOver bottle with the game on macOS.
 */
export async function findGameFolders(): Promise<GameFolder[]> {
  if (!isTauri()) return PREVIEW_FOLDERS;
  try { return await invoke<GameFolder[]>('game_folders'); } catch (e) { console.error(e); return []; }
}

/** Let the user point at a blueprints folder by hand (e.g. a bottle in a custom location). */
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
