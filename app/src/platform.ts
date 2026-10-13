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

/** Fallback shown in the browser preview, mirroring the Windows default. */
export const DEFAULT_BLUEPRINT_DIR = '%LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames\\blueprints';

/** Satisfactory's blueprint root on this machine (per-session folders live underneath). */
export async function blueprintDir(): Promise<string> {
  if (!isTauri()) return DEFAULT_BLUEPRINT_DIR;
  try { return await invoke<string>('blueprint_dir'); } catch { return DEFAULT_BLUEPRINT_DIR; }
}

/** Shorten a long path to its last few segments: …\FactoryGame\Saved\SaveGames\blueprints */
export function tailPath(p: string, segments = 4) {
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length <= segments ? p : '…' + sep + parts.slice(-segments).join(sep);
}
