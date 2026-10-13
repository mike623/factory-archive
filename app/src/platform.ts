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
